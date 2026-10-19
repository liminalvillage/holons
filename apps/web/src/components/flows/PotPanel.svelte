<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The holon's Pot on the dashboard: what the viewer may collect under the
  // committed table, what accrues until the next new moon, and — for an
  // attester — cutting, signing, posting and reviewing the lunation's table.
  // Every number is core's (`cutRights`, `advanceRights`, `potCommitment`,
  // `potClaimArgs`); this panel shows and sends. Parity with the kiosk's.

  import { createEventDispatcher, onDestroy } from "svelte";
  import type { HoloSphere } from "holosphere";
  import {
    FLOW_RIGHTS_LENS,
    buildRightsEntry,
    buildRightsSignature,
    collectable,
    cutRights,
    resourcesOf,
    describeChain,
    foldRightsFromLenses,
    fromBaseUnits,
    latestRights,
    lunationAt,
    payoutAddressOf,
    potClaimArgs,
    potCommitment,
    rightsByRef,
    rightsRoot,
    rootSignatures,
    addPotToken,
    removePotToken,
    safeAppUrl,
    savePayoutAddress,
    savePotTreasury,
    scoreAllocationMembers,
    type CutRights,
    type FoldedRights,
    type PotRecord,
    type RightsTable,
  } from "@holons/core/flows";
  import type { LogEvent, MembershipEnvelope } from "@holons/core/protocol";
  import type { IdentityAttestation } from "@holons/core/shifts";
  import {
    collectOnChain,
    deployPotOnChain,
    describeToken,
    readTreasury,
    postRootOnChain,
    potReceipts,
    readPotState,
    signCommitment,
    sweepOnChain,
    vetoOnChain,
    type PotState,
    type TreasuryState,
  } from "$lib/holons/pot";

  export let holosphere: HoloSphere;
  export let holonID: string;
  export let pot: PotRecord | null;
  export let settings: any = null;
  export let usersById: Record<string, any> = {};
  /** The holon's membership log, policy entries and identity attestations, as the board already holds them. */
  export let membersLog: MembershipEnvelope[] = [];
  export let policyEntries: LogEvent<unknown>[] = [];
  export let attestations: IdentityAttestation[] = [];
  export let selfId: string | null = null;
  export let myShare = 0;
  export let canAttest = false;
  export let partyName: (id: string) => string = (id) => id;

  const dispatch = createEventDispatcher<{ changed: void; receipts: Record<string, number> }>();

  let state: PotState | null = null;
  let treasury: TreasuryState | null = null;
  let stateFor = "";
  let reading = false;
  async function refreshState() {
    if (!pot) {
      state = null;
      return;
    }
    reading = true;
    try {
      state = await readPotState(pot, pot.tokens, selfId);
      treasury = await readTreasury(pot).catch(() => null);
      dispatch("receipts", potReceipts(state));
    } catch {
      state = null;
    } finally {
      reading = false;
    }
  }
  $: {
    const key = pot ? `${pot.chainId}:${pot.address}:${pot.tokens.map((t) => t.address).join(",")}:${pot.treasury?.address ?? ""}:${selfId ?? ""}` : "";
    if (key !== stateFor) {
      stateFor = key;
      void refreshState();
    }
  }
  const timer = setInterval(() => void refreshState(), 60_000);

  // The rights log, watched like the claims log is.
  let entries = new Map<string, LogEvent<unknown>>();
  let off: (() => void) | null = null;
  let boundTo = "";
  $: if (holosphere && holonID && holonID !== boundTo) {
    off?.();
    boundTo = holonID;
    entries = new Map();
    off = holosphere.subscribeLog(holonID, FLOW_RIGHTS_LENS, (e) => {
      if (boundTo !== holonID) return;
      entries.set(e.id, e as LogEvent<unknown>);
      entries = entries;
    });
  }
  onDestroy(() => {
    off?.();
    clearInterval(timer);
  });
  let folded: FoldedRights | null = null;
  $: folded = settings
    ? foldRightsFromLenses({
        holonId: holonID,
        entries: [...entries.values()],
        policyEntries,
        membersLog,
        settings,
        users: Object.values(usersById),
        attestations,
      }).folded
    : null;
  $: latest = pot ? latestRights(folded, pot.chainId, pot.address) : null;
  $: activeTable = state?.active?.tableRef ? (rightsByRef(folded, state.active.tableRef)?.table ?? null) : null;
  $: pendingPublished = state?.pending?.tableRef ? rightsByRef(folded, state.pending.tableRef) : null;
  $: candidate = latest && state && latest.epoch > state.lastEpoch ? latest : null;
  $: candidateSignatures = candidate ? rootSignatures(entries.values(), candidate.id) : [];

  $: units = state?.units ?? [];
  $: myRows =
    selfId && activeTable
      ? units.map((u) => ({ unit: u, owed: collectable(activeTable, selfId!, u.token, u.mine ?? 0n) })).filter((r) => r.owed > 0n)
      : [];
  $: accruing = units
    .map((u) => ({ unit: u, amount: fromBaseUnits(u.received - u.declared, u.decimals) * (myShare / 100) }))
    .filter((r) => r.amount > 0);
  $: nextMoon = lunationAt().to;
  $: epochNow = lunationAt().index;
  let myPayout: string | null = null;
  async function loadMyPayout() {
    if (!selfId || !pot) return;
    try {
      myPayout = payoutAddressOf(await holosphere.get(selfId, "settings", selfId), pot.chainId);
    } catch {
      myPayout = null;
    }
  }
  $: if (selfId && pot) void loadMyPayout();

  let busy = "";
  let error = "";
  let notice = "";
  const fail = (err: unknown) => {
    error = (err as any)?.reason ?? (err as any)?.shortMessage ?? (err instanceof Error ? err.message : String(err));
  };
  const run = async (what: string, fn: () => Promise<void>) => {
    busy = what;
    error = "";
    notice = "";
    try {
      await fn();
    } catch (err) {
      fail(err);
    } finally {
      busy = "";
    }
  };

  const usePayoutWallet = () =>
    run("payout", async () => {
      if (!selfId) return;
      const eth = (window as any).ethereum;
      if (!eth) throw new Error("No Ethereum wallet in this browser.");
      const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
      const address = accounts[0];
      await savePayoutAddress(holosphere, selfId, address);
      myPayout = address.toLowerCase();
      notice = "Payout address saved; it applies at the next new moon.";
    });

  const collect = (token: string) =>
    run("collect", async () => {
      if (!pot || !selfId || !activeTable) return;
      const args = potClaimArgs(activeTable, selfId, token);
      if (!args) throw new Error("The committed table has no row for you yet.");
      await collectOnChain(pot, args);
      await refreshState();
      dispatch("changed");
    });

  let cut: CutRights | null = null;
  const cutTable = () =>
    run("cut", async () => {
      if (!pot) return;
      const received: Record<string, bigint> = {};
      for (const u of units) if (u.received > 0n) received[u.token] = u.received;
      cut = await cutRights(holosphere, holonID, {
        previous: latest?.table ?? null,
        epoch: epochNow,
        chainId: pot.chainId,
        received,
        scoreOf: (id) => scoreAllocationMembers(holosphere, id),
        resourcesOf: resourcesOf(holosphere),
      });
    });
  const publishCut = () =>
    run("publish", async () => {
      if (!pot || !cut?.table || !cut.complete) return;
      const a = buildRightsEntry({ table: cut.table, chainId: pot.chainId, pot: pot.address });
      await holosphere.append(holonID, FLOW_RIGHTS_LENS, a.item, { refs: a.refs });
      cut = null;
      notice = "Table published; signers can now sign it.";
    });
  const signCandidate = () =>
    run("sign", async () => {
      if (!pot || !candidate) return;
      const signed = await signCommitment(pot, potCommitment(candidate.table, candidate.id));
      const a = buildRightsSignature(candidate.id, signed);
      await holosphere.append(holonID, FLOW_RIGHTS_LENS, a.item, { refs: a.refs });
      notice = "Signed.";
    });
  const postCandidate = () =>
    run("post", async () => {
      if (!pot || !candidate) return;
      await postRootOnChain(pot, potCommitment(candidate.table, candidate.id), candidateSignatures);
      await refreshState();
      notice = "Root posted; it applies after the challenge window.";
    });
  let review: { same: boolean; problems: string[] } | null = null;
  const reviewPending = () =>
    run("review", async () => {
      if (!pot || !state?.pending) return;
      const before: RightsTable | null = state.active?.tableRef ? (rightsByRef(folded, state.active.tableRef)?.table ?? null) : null;
      const received: Record<string, bigint> = {};
      for (const [token, total] of Object.entries(state.pending.totals)) received[token] = total;
      const again = await cutRights(holosphere, holonID, {
        previous: before,
        epoch: state.pending.epoch,
        chainId: pot.chainId,
        received,
        scoreOf: (id) => scoreAllocationMembers(holosphere, id),
        resourcesOf: resourcesOf(holosphere),
      });
      review = { same: !!again.table && rightsRoot(again.table.rows) === state.pending.root, problems: again.problems };
    });
  const veto = () =>
    run("veto", async () => {
      if (!pot) return;
      await vetoOnChain(pot);
      review = null;
      await refreshState();
    });
  const sweep = (token: string) =>
    run("sweep", async () => {
      if (!pot) return;
      await sweepOnChain(pot, token);
      await refreshState();
    });
  // The owner is the one key that can veto a root and replace the signers:
  // the connected wallet by default, the genesis Safe for a Pot that must
  // answer to no single key.
  let ownerAddress = "";
  const deploy = () =>
    run("deploy", async () => {
      await deployPotOnChain(holosphere, holonID, { signers: [], threshold: 1, owner: ownerAddress.trim() || null });
      dispatch("changed");
    });

  // The treasury and the tokens the Pot is read in.
  let treasuryAddress = "";
  let treasuryOpen = false;
  let tokenAddress = "";
  async function setTreasury(address: string | null) {
    if (!pot) return;
    busy = "treasury";
    error = "";
    try {
      await savePotTreasury(holosphere, holonID, address ? { address } : null);
      treasuryAddress = "";
      treasuryOpen = false;
      dispatch("changed");
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = "";
    }
  }
  async function trackToken() {
    if (!pot || !tokenAddress.trim()) return;
    busy = "token";
    error = "";
    try {
      await addPotToken(holosphere, holonID, await describeToken(pot.chainId, tokenAddress));
      tokenAddress = "";
      dispatch("changed");
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = "";
    }
  }
  async function untrackToken(address: string) {
    if (!pot) return;
    busy = "token";
    error = "";
    try {
      await removePotToken(holosphere, holonID, address);
      dispatch("changed");
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = "";
    }
  }
  $: safeLink = pot?.treasury ? safeAppUrl(pot.chainId, pot.treasury.address) : null;

  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const when = (sec: number) => new Date(sec * 1000).toLocaleDateString();
  const fmt = (v: bigint, decimals: number, unit: string) => `${fromBaseUnits(v, decimals)} ${unit}`;
  $: explorer = pot ? describeChain(pot.chainId)?.explorer : null;
  let walletNow: string | null = null;
  async function readWallet() {
    const eth = typeof window !== "undefined" ? (window as any).ethereum : null;
    if (!eth) return;
    try {
      const accounts: string[] = await eth.request({ method: "eth_accounts" });
      walletNow = accounts[0]?.toLowerCase() ?? null;
    } catch {
      walletNow = null;
    }
  }
  void readWallet();
  $: isOwner = !!(state?.owner && walletNow && state.owner === walletNow);
  const ZERO = "0x0000000000000000000000000000000000000000";
</script>

{#if pot || canAttest}
  <div class="claims-panel pot">
    <h3>
      The Pot
      {#if pot}<a class="addr" href={explorer ? `${explorer}/address/${pot.address}` : undefined} target="_blank" rel="noreferrer">{short(pot.address)}</a>{/if}
    </h3>
    {#if !pot}
      <p class="note">This holon holds no value on chain yet. A Pot holds it and divides it by a rights table committed at each new moon.</p>
      {#if canAttest}
        <label class="note">Owner (a Safe, or empty for your wallet) — the owner alone can veto a root and replace the signers
          <input type="text" placeholder="0x…" bind:value={ownerAddress} disabled={busy !== ""} /></label>
        <button type="button" disabled={busy !== ""} on:click={deploy}>{busy === "deploy" ? "Creating…" : "Create a Pot"}</button>
      {/if}
    {:else if !state}
      <p class="note">{reading ? "Reading the chain…" : "The Pot cannot be read from here."}</p>
    {:else}
      <ul class="rows">
        {#each units.filter((u) => u.received > 0n || u.free > 0n) as u (u.token)}
          <li>
            <strong>{fmt(u.holdings, u.decimals, u.unit)}</strong>
            <span class="note">received {fmt(u.received, u.decimals, u.unit)} all time</span>
            {#if u.free > 0n}<button type="button" disabled={busy !== ""} on:click={() => sweep(u.token)}>Count {fmt(u.free, u.decimals, u.unit)} into the pool</button>{/if}
          </li>
        {/each}
      </ul>
      <!-- The treasury: the owners' reserve, read and linked; funding the Pot is their transaction. -->
      <p>
        <strong>Treasury</strong>
        {#if pot.treasury}
          <a class="addr" href={explorer ? `${explorer}/address/${pot.treasury.address}` : undefined} target="_blank" rel="noreferrer">{short(pot.treasury.address)}</a>
          {#if treasury && !treasury.contract}<span class="note">a plain address, not a Safe</span>{/if}
          {#if safeLink}<a href={safeLink} target="_blank" rel="noreferrer">Open in Safe Wallet ↗</a>{/if}
        {:else}
          <span class="note">None set. A Safe under the owners' threshold holds what is not yet distributed.</span>
        {/if}
        {#if canAttest}<button type="button" disabled={busy !== ""} on:click={() => (treasuryOpen = !treasuryOpen)}>{pot.treasury ? "Change" : "Set a treasury"}</button>{/if}
      </p>
      {#if pot.treasury}
        <ul class="rows">
          {#each treasury?.lines ?? [] as line (line.unit + (line.address ?? ""))}
            <li><strong>{line.balance} {line.unit}</strong> <span class="note">in the treasury</span></li>
          {/each}
        </ul>
        <p class="note">To distribute, send from the treasury to the Pot <code>{pot.address}</code> and then count it into the pool.</p>
      {/if}
      {#if treasuryOpen}
        <p>
          <input type="text" spellcheck="false" placeholder="Safe or wallet address (0x…) on this chain" bind:value={treasuryAddress} />
          <button type="button" disabled={busy !== "" || !/^0x[0-9a-fA-F]{40}$/.test(treasuryAddress.trim())} on:click={() => setTreasury(treasuryAddress.trim())}>Use this address</button>
          {#if pot.treasury}<button type="button" disabled={busy !== ""} on:click={() => setTreasury(null)}>Remove</button>{/if}
        </p>
      {/if}
      {#if canAttest}
        <p>
          <strong>Read in</strong>
          {#each pot.tokens as tk (tk.address)}
            <span class="token">{tk.symbol} <button type="button" aria-label={`Stop reading in ${tk.symbol}`} disabled={busy !== ""} on:click={() => untrackToken(tk.address)}>×</button></span>
          {/each}
          <input type="text" spellcheck="false" placeholder="Token address (0x…) to read the Pot in" bind:value={tokenAddress} />
          <button type="button" disabled={busy !== "" || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress.trim())} on:click={trackToken}>{busy === "token" ? "Reading…" : "Track"}</button>
        </p>
      {/if}
      {#if selfId}
        {#each myRows as r (r.unit.token)}
          <p>
            <strong>{fmt(r.owed, r.unit.decimals, r.unit.unit)}</strong> yours to collect
            <button type="button" disabled={busy !== "" || !myPayout} on:click={() => collect(r.unit.token)}>{busy === "collect" ? "Collecting…" : "Collect"}</button>
          </p>
        {/each}
        {#if accruing.length}
          <p class="note">Accruing {accruing.map((a) => `${Math.round(a.amount * 100) / 100} ${a.unit.unit}`).join(", ")}, committed at the new moon on {when(nextMoon / 1000)}.</p>
        {/if}
        <p class="note">
          {myPayout ? `Paid at ${short(myPayout)}.` : "No payout address yet — set one and it applies at the next new moon."}
          <button type="button" disabled={busy !== ""} on:click={usePayoutWallet}>Use this wallet</button>
        </p>
      {/if}
      {#if state.pending}
        <p class="note">
          Lunation {state.pending.epoch} posted, applies {when(state.pending.appliesAt)}.
          {#if !pendingPublished}<span class="warn">The table behind this root has not reached this reader.</span>{/if}
          {#if canAttest}
            <button type="button" disabled={busy !== ""} on:click={reviewPending}>Check it</button>
            {#if review}<span class:warn={!review.same}>{review.same ? "Rebuilt here: same root." : "Rebuilt here: a different root."}</span>{#each review.problems as p}<span class="warn">{p}</span>{/each}{/if}
            {#if isOwner}<button type="button" disabled={busy !== ""} on:click={veto}>Veto</button>{/if}
          {/if}
        </p>
      {:else if state.active}
        <p class="note">Lunation {state.active.epoch} in force since {when(state.active.since)}.</p>
      {:else}
        <p class="note">No rights committed yet.</p>
      {/if}
      {#if canAttest && !state.pending}
        {#if candidate}
          <p class="note">
            Lunation {candidate.epoch} published: {candidate.table.rows.length} rows, {candidateSignatures.length} of {state.threshold} signatures.
            <button type="button" disabled={busy !== ""} on:click={signCandidate}>{busy === "sign" ? "Signing…" : "Sign"}</button>
            {#if candidateSignatures.length >= state.threshold}
              <button type="button" disabled={busy !== "" || state.lunationNow <= state.lastLunation} on:click={postCandidate}>{busy === "post" ? "Posting…" : "Post on chain"}</button>
            {/if}
            {#if state.lunationNow <= state.lastLunation}<span class="warn">This lunation already has its root.</span>{/if}
          </p>
        {:else if epochNow > state.lastEpoch}
          {#if !cut}
            <button type="button" disabled={busy !== ""} on:click={cutTable}>{busy === "cut" ? "Cutting…" : `Cut the table for lunation ${epochNow}`}</button>
          {:else}
            <table class="claims">
              <tbody>
                {#each cut.table?.rows ?? [] as r (r.party + r.token)}
                  <tr>
                    <td>{partyName(r.party)}</td>
                    <td>{fmt(r.cumulative, units.find((u) => u.token === r.token)?.decimals ?? 18, units.find((u) => u.token === r.token)?.unit ?? "")}</td>
                    <td class="note">{r.to === ZERO ? "no address" : short(r.to)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
            {#each cut.problems as p}<p class="note warn">{p}</p>{/each}
            <p>
              {#if cut.complete}<button type="button" disabled={busy !== ""} on:click={publishCut}>{busy === "publish" ? "Publishing…" : "Publish"}</button>{/if}
              <button type="button" on:click={() => (cut = null)}>Discard</button>
            </p>
          {/if}
        {:else}
          <p class="note">Committed up to date; the next table is cut at the new moon on {when(nextMoon / 1000)}.</p>
        {/if}
      {/if}
    {/if}
    {#if error}<p class="note warn">{error}</p>{/if}
    {#if notice}<p class="note">{notice}</p>{/if}
  </div>
{/if}

<style>
  .addr {
    margin-left: 0.5rem;
    font-family: ui-monospace, monospace;
    font-size: 0.8em;
    font-weight: normal;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.25rem;
  }
  .rows li,
  p {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
  }
  .warn {
    color: var(--danger, #b00);
  }
  .token {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.1rem 0.5rem;
    border: 1px solid currentColor;
    border-radius: 999px;
  }
  .token button {
    padding: 0 0.3rem;
  }
  code {
    word-break: break-all;
    user-select: all;
  }
</style>
