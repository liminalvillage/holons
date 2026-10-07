<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The holon's Pot on the board: what the viewer may collect under the
  // committed table, what is accruing until the next new moon, and — for an
  // attester — cutting, signing, posting and reviewing the lunation's table.
  //
  // Everything that decides a number is core: `cutRights` walks the cascade,
  // `advanceRights` divides the lunation, `potCommitment` is what is signed,
  // `potClaimArgs` is what is collected. This panel only shows and sends.

  import { createEventDispatcher, onDestroy } from "svelte";
  import type { HoloSphere } from "holosphere";
  import {
    FLOW_RIGHTS_LENS,
    buildRightsEntry,
    buildRightsSignature,
    collectable,
    cutRights,
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
    savePayoutAddress,
    scoreAllocationMembers,
    type BundleToken,
    type CutRights,
    type FoldedRights,
    type PotRecord,
    type PublishedRights,
    type RightsTable,
  } from "@holons/core/flows";
  import { describeChain } from "@holons/core/flows";
  import { t } from "$lib/i18n";
  import { now } from "$lib/stores";
  import { ChainError, connectedWallet, isWalletAvailable } from "$lib/chain";
  import { watchLogLens, recordLogEntry, type ClaimsLogs } from "$lib/flowsClaims";
  import {
    collectOnChain,
    deployPotOnChain,
    postRootOnChain,
    potReceipts,
    readPotState,
    signCommitment,
    sweepOnChain,
    vetoOnChain,
    type PotState,
  } from "$lib/pot";

  export let hs: HoloSphere;
  export let holon: string;
  export let pot: PotRecord | null;
  export let tokens: BundleToken[] = [];
  export let settings: any = null;
  export let usersById: Record<string, any> = {};
  export let selfId: string | null = null;
  /** The viewer's share of the root pot per the cascade, 0..100, for the accrual estimate. */
  export let myShare = 0;
  /** Whether the viewer is an attester of this holon's logs. */
  export let canAttest = false;
  export let nameFor: (id: string) => string | undefined = () => undefined;

  const dispatch = createEventDispatcher<{ changed: void; receipts: Record<string, number> }>();

  // ── The chain ───────────────────────────────────────────────────────────
  let state: PotState | null = null;
  let stateFor = "";
  let reading = false;
  async function refreshState() {
    if (!pot) {
      state = null;
      return;
    }
    reading = true;
    try {
      state = await readPotState(pot, tokens, selfId);
      dispatch("receipts", potReceipts(state));
    } catch {
      state = null;
    } finally {
      reading = false;
    }
  }
  $: {
    const key = pot ? `${pot.chainId}:${pot.address}:${tokens.map((t) => t.address).join(",")}:${selfId ?? ""}` : "";
    if (key !== stateFor) {
      stateFor = key;
      void refreshState();
    }
  }
  const timer = setInterval(() => void refreshState(), 60_000);

  // ── The published tables ────────────────────────────────────────────────
  let logs: ClaimsLogs | null = null;
  let off: (() => void) | null = null;
  let boundTo = "";
  $: if (hs && holon && holon !== boundTo) {
    off?.();
    boundTo = holon;
    off = watchLogLens(hs, holon, FLOW_RIGHTS_LENS, (l) => {
      if (boundTo === holon) logs = l;
    });
  }
  onDestroy(() => {
    off?.();
    clearInterval(timer);
  });
  let folded: FoldedRights | null = null;
  $: folded =
    logs && settings
      ? foldRightsFromLenses({
          holonId: holon,
          entries: logs.entries,
          policyEntries: logs.policy,
          membersLog: logs.members,
          settings,
          users: Object.values(usersById),
          attestations: logs.attestations,
        }).folded
      : null;
  $: latest = pot ? latestRights(folded, pot.chainId, pot.address) : null;
  $: activeTable = state?.active?.tableRef ? (rightsByRef(folded, state.active.tableRef)?.table ?? null) : null;
  $: pendingPublished = state?.pending?.tableRef ? rightsByRef(folded, state.pending.tableRef) : null;
  // Tables published but not on chain yet — this moon's candidate.
  $: candidate =
    latest && state && latest.epoch > state.lastEpoch ? latest : null;
  $: candidateSignatures = candidate && logs ? rootSignatures(logs.entries, candidate.id) : [];

  // ── The viewer ──────────────────────────────────────────────────────────
  $: units = state?.units ?? [];
  $: myRows = selfId && activeTable
    ? units
        .map((u) => ({ unit: u, owed: collectable(activeTable, selfId!, u.token, u.mine ?? 0n) }))
        .filter((r) => r.owed > 0n)
    : [];
  // Accruing: the viewer's leaf share of what arrived since the last commitment.
  $: accruing = units
    .map((u) => ({ unit: u, amount: fromBaseUnits(u.received - u.declared, u.decimals) * (myShare / 100) }))
    .filter((r) => r.amount > 0);
  $: nextMoon = lunationAt($now.getTime()).to;
  $: epochNow = lunationAt($now.getTime()).index;
  $: myPayout = selfId && settings && settings.id === selfId ? payoutAddressOf(settings, pot?.chainId ?? 0) : null;
  let myPayoutLoaded: string | null = null;
  async function loadMyPayout() {
    if (!selfId || !pot) return;
    try {
      myPayoutLoaded = payoutAddressOf(await hs.get(selfId, "settings", selfId), pot.chainId);
    } catch {
      myPayoutLoaded = null;
    }
  }
  $: if (selfId && pot) void loadMyPayout();

  let busy = "";
  let error = "";
  let notice = "";
  const fail = (err: unknown) => {
    error = err instanceof ChainError || err instanceof Error ? err.message : String(err);
  };

  async function usePayoutWallet() {
    if (!selfId) return;
    busy = "payout";
    error = "";
    try {
      const address = await connectedWallet();
      await savePayoutAddress(hs, selfId, address);
      myPayoutLoaded = address.toLowerCase();
      notice = $t("pot.payoutSaved");
    } catch (err) {
      fail(err);
    } finally {
      busy = "";
    }
  }

  async function collect(unitToken: string) {
    if (!pot || !selfId || !activeTable) return;
    const args = potClaimArgs(activeTable, selfId, unitToken);
    if (!args) {
      error = $t("pot.noRow");
      return;
    }
    busy = "collect";
    error = "";
    try {
      await collectOnChain(pot, args);
      await refreshState();
      dispatch("changed");
    } catch (err) {
      fail(err);
    } finally {
      busy = "";
    }
  }

  // ── The attester ────────────────────────────────────────────────────────
  let cut: CutRights | null = null;
  let cutting = false;
  async function cutTable() {
    if (!pot || !state) return;
    cutting = true;
    error = "";
    try {
      const received: Record<string, bigint> = {};
      for (const u of units) if (u.received > 0n) received[u.token] = u.received;
      cut = await cutRights(hs, holon, {
        previous: latest?.table ?? null,
        epoch: epochNow,
        chainId: pot.chainId,
        received,
        scoreOf: (id) => scoreAllocationMembers(hs, id),
      });
    } catch (err) {
      fail(err);
    } finally {
      cutting = false;
    }
  }

  async function publishCut() {
    if (!pot || !cut?.table || !cut.complete) return;
    busy = "publish";
    error = "";
    try {
      await recordLogEntry(hs, holon, FLOW_RIGHTS_LENS, buildRightsEntry({ table: cut.table, chainId: pot.chainId, pot: pot.address }) as never);
      cut = null;
      notice = $t("pot.published");
    } catch (err) {
      fail(err);
    } finally {
      busy = "";
    }
  }

  async function signCandidate() {
    if (!pot || !candidate) return;
    busy = "sign";
    error = "";
    try {
      const signed = await signCommitment(pot, potCommitment(candidate.table, candidate.id));
      await recordLogEntry(hs, holon, FLOW_RIGHTS_LENS, buildRightsSignature(candidate.id, signed) as never);
      notice = $t("pot.signed");
    } catch (err) {
      fail(err);
    } finally {
      busy = "";
    }
  }

  async function postCandidate() {
    if (!pot || !candidate) return;
    busy = "post";
    error = "";
    try {
      await postRootOnChain(pot, potCommitment(candidate.table, candidate.id), candidateSignatures);
      await refreshState();
      notice = $t("pot.posted");
    } catch (err) {
      fail(err);
    } finally {
      busy = "";
    }
  }

  // Rebuild the pending table and compare roots: the reviewer's check.
  let review: { same: boolean; problems: string[] } | null = null;
  async function reviewPending() {
    if (!pot || !state?.pending) return;
    busy = "review";
    error = "";
    try {
      const before: RightsTable | null = state.active?.tableRef ? (rightsByRef(folded, state.active.tableRef)?.table ?? null) : null;
      const received: Record<string, bigint> = {};
      for (const [token, total] of Object.entries(state.pending.totals)) received[token] = total;
      const again = await cutRights(hs, holon, {
        previous: before,
        epoch: state.pending.epoch,
        chainId: pot.chainId,
        received,
        scoreOf: (id) => scoreAllocationMembers(hs, id),
      });
      const same = !!again.table && rightsRoot(again.table.rows) === state.pending.root;
      review = { same, problems: again.problems };
    } catch (err) {
      fail(err);
    } finally {
      busy = "";
    }
  }

  async function veto() {
    if (!pot) return;
    busy = "veto";
    error = "";
    try {
      await vetoOnChain(pot);
      review = null;
      await refreshState();
    } catch (err) {
      fail(err);
    } finally {
      busy = "";
    }
  }

  async function sweep(token: string) {
    if (!pot) return;
    busy = "sweep";
    error = "";
    try {
      await sweepOnChain(pot, token);
      await refreshState();
    } catch (err) {
      fail(err);
    } finally {
      busy = "";
    }
  }

  async function deploy() {
    busy = "deploy";
    error = "";
    try {
      await deployPotOnChain(hs, holon, { signers: [], threshold: 1 });
      dispatch("changed");
    } catch (err) {
      fail(err);
    } finally {
      busy = "";
    }
  }

  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const when = (sec: number) => new Date(sec * 1000).toLocaleDateString();
  const fmt = (v: bigint, decimals: number, unit: string) => `${fromBaseUnits(v, decimals)} ${unit}`;
  $: explorer = pot ? describeChain(pot.chainId)?.explorer : null;
  $: isOwner = !!(state?.owner && walletNow && state.owner === walletNow);
  let walletNow: string | null = null;
  async function readWallet() {
    if (!isWalletAvailable()) return;
    try {
      const w = (window as any).ethereum;
      const accounts: string[] = await w.request({ method: "eth_accounts" });
      walletNow = accounts[0]?.toLowerCase() ?? null;
    } catch {
      walletNow = null;
    }
  }
  void readWallet();
</script>

{#if pot || canAttest}
  <section class="pot" aria-label={$t("pot.title")}>
    <div class="head">
      <div class="k">{$t("pot.title")}</div>
      {#if pot}
        <a class="addr" href={explorer ? `${explorer}/address/${pot.address}` : undefined} target="_blank" rel="noreferrer">{short(pot.address)}</a>
      {/if}
    </div>

    {#if !pot}
      <p class="sub">{$t("pot.none")}</p>
      {#if canAttest}
        <button class="btn" disabled={busy !== ""} on:click={deploy}>{busy === "deploy" ? $t("pot.deploying") : $t("pot.deploy")}</button>
      {/if}
    {:else if !state}
      <p class="sub">{reading ? $t("pot.reading") : $t("pot.unreadable")}</p>
    {:else}
      <!-- What the pool holds -->
      <ul class="units">
        {#each units.filter((u) => u.received > 0n || u.free > 0n) as u (u.token)}
          <li>
            <span class="amt">{fmt(u.holdings, u.decimals, u.unit)}</span>
            <span class="memo">{$t("pot.held", { received: fmt(u.received, u.decimals, u.unit) })}</span>
            {#if u.free > 0n}
              <button class="chip" disabled={busy !== ""} on:click={() => sweep(u.token)}>{$t("pot.sweep", { amount: fmt(u.free, u.decimals, u.unit) })}</button>
            {/if}
          </li>
        {/each}
      </ul>

      <!-- The viewer -->
      {#if selfId}
        {#if myRows.length}
          <ul class="units mine">
            {#each myRows as r (r.unit.token)}
              <li>
                <span class="amt">{fmt(r.owed, r.unit.decimals, r.unit.unit)}</span>
                <span class="memo">{$t("pot.collectable")}</span>
                <button class="btn" disabled={busy !== "" || !myPayoutLoaded} on:click={() => collect(r.unit.token)}>{busy === "collect" ? $t("pot.collecting") : $t("pot.collect")}</button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if accruing.length}
          <p class="sub">
            {$t("pot.accruing", { amounts: accruing.map((a) => `${Math.round(a.amount * 100) / 100} ${a.unit.unit}`).join(", "), when: when(nextMoon / 1000) })}
          </p>
        {/if}
        <p class="sub payout">
          {#if myPayoutLoaded ?? myPayout}
            {$t("pot.paidAt", { address: short(myPayoutLoaded ?? myPayout ?? "") })}
          {:else}
            {$t("pot.noPayout")}
          {/if}
          <button class="chip" disabled={busy !== ""} on:click={usePayoutWallet}>{$t("pot.useWallet")}</button>
        </p>
      {/if}

      <!-- Roots -->
      {#if state.pending}
        <div class="root pending">
          <span class="memo">{$t("pot.pending", { epoch: state.pending.epoch, when: when(state.pending.appliesAt) })}</span>
          {#if !pendingPublished}<span class="warn">{$t("pot.tableMissing")}</span>{/if}
          {#if canAttest}
            <button class="chip" disabled={busy !== ""} on:click={reviewPending}>{$t("pot.review")}</button>
            {#if review}
              <span class:ok={review.same} class:warn={!review.same}>{review.same ? $t("pot.reviewSame") : $t("pot.reviewDiffers")}</span>
              {#each review.problems as p}<span class="warn">{p}</span>{/each}
            {/if}
            {#if isOwner}
              <button class="chip danger" disabled={busy !== ""} on:click={veto}>{$t("pot.veto")}</button>
            {/if}
          {/if}
        </div>
      {:else if state.active}
        <p class="sub">{$t("pot.active", { epoch: state.active.epoch, when: when(state.active.since) })}</p>
      {:else}
        <p class="sub">{$t("pot.noRoot")}</p>
      {/if}

      <!-- The attester: this moon's table -->
      {#if canAttest && !state.pending}
        {#if candidate}
          <div class="root">
            <span class="memo">{$t("pot.candidate", { epoch: candidate.epoch, count: candidate.table.rows.length })}</span>
            <span class="memo">{$t("pot.signatures", { have: candidateSignatures.length, need: state.threshold })}</span>
            <button class="chip" disabled={busy !== ""} on:click={signCandidate}>{busy === "sign" ? $t("pot.signing") : $t("pot.sign")}</button>
            {#if candidateSignatures.length >= state.threshold}
              <button class="btn" disabled={busy !== "" || state.lunationNow <= state.lastLunation} on:click={postCandidate}>{busy === "post" ? $t("pot.posting") : $t("pot.post")}</button>
            {/if}
            {#if state.lunationNow <= state.lastLunation}<span class="warn">{$t("pot.lunationSpent")}</span>{/if}
          </div>
        {:else if epochNow > state.lastEpoch}
          <div class="root">
            {#if !cut}
              <button class="btn" disabled={cutting} on:click={cutTable}>{cutting ? $t("pot.cutting") : $t("pot.cut", { epoch: epochNow })}</button>
            {:else}
              <span class="memo">{$t("pot.cutRows", { count: cut.table?.rows.length ?? 0 })}</span>
              <ul class="rows">
                {#each cut.table?.rows ?? [] as r (r.party + r.token)}
                  <li>
                    <span>{nameFor(r.party) ?? r.party}</span>
                    <span class="amt">{fmt(r.cumulative, units.find((u) => u.token === r.token)?.decimals ?? 18, units.find((u) => u.token === r.token)?.unit ?? "")}</span>
                    <span class="memo">{r.to === "0x0000000000000000000000000000000000000000" ? $t("pot.noPayoutShort") : short(r.to)}</span>
                  </li>
                {/each}
              </ul>
              {#each cut.problems as p}<span class="warn">{p}</span>{/each}
              {#if cut.complete}
                <button class="btn" disabled={busy !== ""} on:click={publishCut}>{busy === "publish" ? $t("pot.publishing") : $t("pot.publish")}</button>
              {/if}
              <button class="chip" on:click={() => (cut = null)}>{$t("pot.discard")}</button>
            {/if}
          </div>
        {:else}
          <p class="sub">{$t("pot.upToDate", { when: when(nextMoon / 1000) })}</p>
        {/if}
      {/if}
    {/if}

    {#if error}<p class="err" role="alert">{error}</p>{/if}
    {#if notice}<p class="sub ok">{notice}</p>{/if}
  </section>
{/if}

<style>
  .pot {
    display: grid;
    gap: 8px;
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--glass, rgba(255, 255, 255, 0.5));
    color: var(--teal-ink, inherit);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  .k {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.85;
  }
  .addr {
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
    color: inherit;
  }
  .sub {
    margin: 0;
    font-size: 0.9rem;
  }
  .units,
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .units li,
  .rows li {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .amt {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .memo {
    font-size: 0.85rem;
    opacity: 0.85;
  }
  .root {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid currentColor;
  }
  .root.pending {
    border-style: dashed;
  }
  .btn,
  .chip {
    min-height: 44px;
    padding: 0 14px;
    border-radius: 999px;
    border: 1px solid currentColor;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .btn {
    background: var(--teal-ink, #0b5);
    color: var(--on-teal, #fff);
    border-color: transparent;
  }
  .btn:disabled,
  .chip:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .chip.danger {
    color: var(--danger, #b00);
  }
  .warn {
    color: var(--danger, #b00);
    font-size: 0.85rem;
  }
  .ok {
    color: inherit;
    font-size: 0.85rem;
  }
  .err {
    margin: 0;
    color: var(--danger, #b00);
    font-size: 0.9rem;
  }
  .payout {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
</style>
