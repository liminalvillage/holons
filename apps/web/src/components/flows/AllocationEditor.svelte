<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The allocation split, made editable where it is read.
  //
  // Flow Management (/[id]/flow) is the concentric editor: drag a partner onto
  // a ring, watch the geometry. This is the same split expressed as controls
  // next to the Sankey it feeds — move a slider and the diagram above answers
  // immediately, because the parent's `allocate()` runs off these very values.
  //
  // Saving has two halves, and they are deliberately separable:
  //
  //   Save            — writes the settings mirror only. No wallet needed, and
  //                     it is what every wallet-less surface reads (the kiosk
  //                     board, this page).
  //   Update on chain — the Bundle contract's `syncAll`, then the same mirror,
  //                     both through `lib/holons/allocationSync` so this panel
  //                     and Flow Management cannot push different things.
  //
  // Deploying a bundle is NOT here: it mints a contract and belongs with the
  // rest of the deploy flow in Flow Management, which this panel links to.

  import { createEventDispatcher, onMount } from "svelte";
  import { ethers } from "ethers";
  import type { HoloSphere } from "holosphere";
  import { walletAddress } from "../../dashboard/store";
  import { HolonsManager } from "../../lib/holons/HolonsManager";
  import {
    mirrorAllocation,
    syncAllocation,
    type SyncMember,
    type SyncPartner,
  } from "../../lib/holons/allocationSync";
  import {
    allocate,
    bindingAuthority,
    bindingPreflight,
    loadBundleRecord,
    normalizeInteriorShares,
    resolveInteriorMembers,
    sharesFromMembers,
    interiorSharePercentages,
  } from "@holons/core/flows";
  import {
    bindMember,
    readBindings,
    type BundleBindings,
  } from "../../lib/holons/bindings";
  import { ZONE_COLORS } from "../flow/types";
  import type {
    CascadeResult,
    HolonBundleRecord,
    InteriorMode,
    InteriorShares,
  } from "@holons/core/flows";

  export let holonId = "";
  export let holosphere: HoloSphere | null = null;

  /** The live draft. Bound, so the diagram above moves with the sliders. */
  export let interiorPercent = 50;
  export let steepness = 50;
  export let nzones = 6;
  /** Partner id → ring. 0 means "not placed in any zone". */
  export let zoneOf: Record<string, number> = {};
  /** How the contributors' share is divided: by the equation, or by hand. */
  export let interiorMode: InteriorMode = "equation";
  /** The hand-set split, member id → share. Bound; read under `custom`. */
  export let shares: InteriorShares = {};

  /** Federated partners available to place, names already resolved. */
  export let partners: { id: string; name: string }[] = [];
  /** Interior shares from the contribution scoring, for the on-chain sync. */
  export let members: SyncMember[] = [];
  /** Everyone a custom split could name, the roster with names resolved. */
  export let people: { id: string; name: string }[] = [];
  /** What is currently saved, so "changed" means changed from the record. */
  export let saved: {
    interiorPercent: number;
    steepness: number;
    nzones: number;
    zones: Record<string, number>;
    interiorMode?: InteriorMode;
    shares?: InteriorShares;
  } = { interiorPercent: 50, steepness: 50, nzones: 6, zones: {} };
  /** The cascade the board resolved, for the pre-flight before a bind. */
  export let cascade: CascadeResult | null = null;

  const dispatch = createEventDispatcher<{
    saved: { onChain: boolean };
    reset: void;
  }>();

  let manager: HolonsManager | null = null;
  let bundle: HolonBundleRecord | null = null;
  let provider: ethers.BrowserProvider | null = null;
  let signer: ethers.Signer | null = null;
  let networkName = "";
  let connecting = false;
  let busy = false;
  let notice = "";
  let noticeKind: "info" | "error" | "success" = "info";
  let open = false;

  $: exteriorPercent = 100 - interiorPercent;
  $: placed = partners.filter((p) => (zoneOf[p.id] ?? 0) >= 1).length;

  // What each zone — and each partner in it — actually receives, as a share
  // of the WHOLE fund: the draft run through the same `allocate()` the Sankey
  // draws and the Bundle contract pays by. An empty zone next to an occupied
  // one shows 0%, because that is what the chain would send it; with nobody
  // placed at all the zones keep their decay shape as a preview.
  $: draft = allocate({
    total: null,
    config: { interiorPercent, steepness, nzones },
    members: [],
    zoned: partners.map((p) => ({ ...p, zone: zoneOf[p.id] ?? 0 })),
  });
  $: zoneShares = draft.exterior.map((z) => z.percentage);
  $: maxZoneShare = Math.max(0, ...zoneShares);
  $: partnerShare = (id: string): number =>
    draft.exterior
      .flatMap((z) => z.members ?? [])
      .find((m) => m.id === id)?.percentage ?? 0;
  $: partnersIn = (zone: number): string[] =>
    (draft.exterior[zone - 1]?.members ?? []).map((m) => m.label);
  const pct = (v: number) => `${Math.round(v * 10) / 10}%`;
  /** The same rounding as `pct`, bare — a number box holds no percent sign. */
  const num = (v: number) => String(Math.round(v * 10) / 10);

  // The custom split as rows: everyone named in the shares map, with the
  // scored share beside each so the caretaker can see what the equation
  // would have given. Someone in the map the roster no longer knows keeps
  // their id, so they can still be removed.
  $: nameOf = new Map<string, string>(people.map((p) => [p.id, p.name]));
  $: scoredOf = new Map<string, number>(
    members.map((m) => [String(m.userId), m.percentage]),
  );
  let shareText: Record<string, string> = {};
  // The box shows a rounded figure; the split keeps the value equation's exact
  // one underneath, so a copied split pays exactly what the equation paid and
  // the number never jumps while it is being typed.
  // The boxes hold plain numbers — 1/2/1 or 25/50/25, either is a split —
  // and the percentage each amounts to is worked out beside it.
  $: shareOfTotal = interiorSharePercentages(shares);
  $: shareRows = Object.keys(shares).map((id) => ({
    id,
    name: nameOf.get(id) ?? id,
    scored: scoredOf.get(id),
    text: shareText[id] ?? num(shares[id]),
    ofTotal: shareOfTotal[id] ?? 0,
  }));
  $: sharesTotal = Object.values(shares).reduce(
    (s, v) => s + (Number.isFinite(v) && v > 0 ? v : 0),
    0,
  );
  $: addable = people
    .filter((p) => !(p.id in shares))
    .sort((a, b) => a.name.localeCompare(b.name));
  let pick = "";

  /** The equation's split, as it would be copied. */
  $: equationShares = sharesFromMembers(
    members.map((m) => ({ id: String(m.userId), name: "", percentage: m.percentage })),
  );

  function setMode(mode: InteriorMode) {
    interiorMode = mode;
    // Custom starts from the equation, unless a split was already entered.
    if (mode === "custom" && Object.keys(shares).length === 0) copyEquation();
  }

  function copyEquation() {
    shares = { ...equationShares };
    shareText = Object.fromEntries(
      Object.entries(shares).map(([id, value]) => [id, num(value)]),
    );
  }

  function setShare(id: string, raw: string) {
    const value = Number(raw);
    shareText = { ...shareText, [id]: raw };
    shares = {
      ...shares,
      [id]: Number.isFinite(value) && value >= 0 ? value : 0,
    };
  }

  function removeShare(id: string) {
    const next = { ...shares };
    delete next[id];
    shares = next;
    const text = { ...shareText };
    delete text[id];
    shareText = text;
  }

  function addShare() {
    if (!pick) return;
    shares = { ...shares, [pick]: 0 };
    shareText = { ...shareText, [pick]: "0" };
    pick = "";
  }

  function sameShares(a: InteriorShares, b: InteriorShares): boolean {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
  }

  $: changed =
    interiorPercent !== saved.interiorPercent ||
    steepness !== saved.steepness ||
    nzones !== saved.nzones ||
    interiorMode !== (saved.interiorMode ?? "equation") ||
    !sameShares(normalizeInteriorShares(shares), saved.shares ?? {}) ||
    partners.some((p) => (zoneOf[p.id] ?? 0) !== (saved.zones[p.id] ?? 0));

  $: connected = !!$walletAddress && !!manager;

  function say(message: string, kind: "info" | "error" | "success" = "info") {
    notice = message;
    noticeKind = kind;
  }

  function setZone(id: string, zone: number) {
    // A new object each time: the parent binds this and needs the assignment.
    zoneOf = { ...zoneOf, [id]: zone };
  }

  /**
   * Placing a partner beyond the last ring would silently drop it from the
   * sync, so shrinking the zone count pulls the strays back to the edge.
   */
  $: if (nzones > 0) {
    for (const partner of partners) {
      const zone = zoneOf[partner.id] ?? 0;
      if (zone > nzones) setZone(partner.id, nzones);
    }
  }

  function partnersForSync(): SyncPartner[] {
    return partners.map((p) => ({ id: p.id, zone: zoneOf[p.id] ?? 0 }));
  }

  async function connect() {
    if (typeof window === "undefined" || !(window as any).ethereum) {
      say("No web3 wallet found in this browser.", "error");
      return;
    }
    try {
      connecting = true;
      provider = new ethers.BrowserProvider((window as any).ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      if (!accounts.length) return;

      signer = await provider.getSigner();
      walletAddress.set(await signer.getAddress());

      const network = await provider.getNetwork();
      networkName =
        network.name === "unknown" ? `chain ${network.chainId}` : network.name;

      if (holosphere) {
        manager = new HolonsManager(provider, holosphere);
        await manager.connectWallet(signer);
      }
      say("");
    } catch (err: any) {
      if (err?.code === 4001 || err?.code === "ACTION_REJECTED") {
        say("Wallet connection rejected.", "error");
      } else {
        say(err?.message ?? "Could not connect the wallet.", "error");
      }
    } finally {
      connecting = false;
    }
  }

  /** Off-chain only: the record every wallet-less surface reads. */
  async function save() {
    if (!holosphere || !holonId) return;
    try {
      busy = true;
      await mirrorAllocation(
        holosphere,
        holonId,
        { interiorPercent, steepness, nzones, interiorMode },
        partnersForSync(),
        shares,
      );
      say("Saved. Every wallet-less surface reads this.", "success");
      dispatch("saved", { onChain: false });
    } catch (err: any) {
      say(err?.message ?? "Could not save the split.", "error");
    } finally {
      busy = false;
    }
  }

  /** The contract, then the same mirror. */
  async function updateOnChain() {
    if (!manager || !bundle) return;
    try {
      busy = true;
      say("Confirm the transaction in your wallet…");
      const tx = await syncAllocation({
        manager,
        holosphere,
        holonId,
        bundleAddress: bundle.address,
        draft: { interiorPercent, steepness, nzones, interiorMode },
        members,
        partners: partnersForSync(),
        shares,
      });
      say(`Submitted — ${tx.hash.slice(0, 10)}… Waiting for confirmation.`);
      const receipt = await tx.wait();
      if (receipt?.status === 1) {
        say("Updated on chain, and mirrored off it.", "success");
        dispatch("saved", { onChain: true });
      } else {
        say("The transaction failed on chain.", "error");
      }
    } catch (err: any) {
      if (err?.code === 4001 || err?.code === "ACTION_REJECTED") {
        say("Transaction rejected.", "error");
      } else {
        say(err?.message ?? "Could not update on chain.", "error");
      }
    } finally {
      busy = false;
    }
  }

  // ── Bindings: who each share is paid to on chain ───────────────────────
  // Read once the wallet is connected (reads prompt nothing), re-read after
  // a bind. The contract decides who may bind — the owner wallet or the
  // wallet already bound — and `bindingAuthority` is that same rule, so the
  // panel can say so before the chain refuses.
  let bindings: BundleBindings | null = null;
  let bindingsKey = "";
  let bindFor = "";
  let bindAddress = "";
  let bindOwnBundle: string | null = null;
  let bindBusy = false;

  // Everyone the root pays, as the draft stands.
  $: parties = [
    ...new Map(
      [
        ...resolveInteriorMembers({
          config: { interiorMode },
          scored: members.map((m) => ({
            id: String(m.userId),
            name: nameOf.get(String(m.userId)) ?? String(m.userId),
            percentage: m.percentage,
          })),
          shares,
          nameOf: (id) => nameOf.get(id),
        }).map((m) => ({ id: m.id, name: m.name })),
        ...partners.filter((p) => (zoneOf[p.id] ?? 0) >= 1),
      ].map((p) => [p.id, p]),
    ).values(),
  ];
  $: partyIds = parties
    .map((p) => p.id)
    .sort()
    .join("|");
  $: if (open && provider && bundle) void loadBindings(bundle.address, partyIds);

  async function loadBindings(address: string, ids: string) {
    const want = `${address}#${ids}`;
    if (!provider || want === bindingsKey) return;
    bindingsKey = want;
    try {
      const read = await readBindings(provider, address, ids ? ids.split("|") : []);
      if (bindingsKey === want) bindings = read;
    } catch (err) {
      console.warn("[flows] bindings read failed", err);
      if (bindingsKey === want) bindings = null;
    }
  }

  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

  function boundLabel(read: BundleBindings, id: string): string {
    const addr = read.bound[id];
    if (!addr && !read.member[id]) return "Not on the contract yet — update on chain first";
    if (!addr) return "Not bound — held in the contract until claimed";
    return read.isContract[id] ? `Their Bundle ${short(addr)}` : `Wallet ${short(addr)}`;
  }

  /** Open the form for one party; their own Bundle is offered first. */
  async function openBind(id: string) {
    bindFor = id;
    bindOwnBundle = null;
    bindAddress = "";
    if (!holosphere) return;
    try {
      const own = await loadBundleRecord(holosphere, id);
      if (bindFor !== id) return;
      bindOwnBundle = own?.address ?? null;
      bindAddress = bindOwnBundle ?? bindings?.bound[id] ?? "";
    } catch {
      // No settings for that holon: a plain address can still be typed.
    }
  }

  $: bindToOwnBundle =
    !!bindOwnBundle && bindAddress.trim().toLowerCase() === bindOwnBundle.toLowerCase();
  $: bindPreflight = bindingPreflight(cascade, bindFor, { toContract: bindToOwnBundle });
  $: bindAuthority = bindings
    ? bindingAuthority({
        wallet: $walletAddress,
        owner: bindings.owner,
        bound: bindings.bound[bindFor],
      })
    : "none";
  $: bindValid = /^0x[0-9a-fA-F]{40}$/.test(bindAddress.trim());

  async function sendBind() {
    if (!signer || !bundle || !bindFor || bindBusy || !bindValid) return;
    try {
      bindBusy = true;
      say("Confirm the transaction in your wallet…");
      const tx = await bindMember(signer, {
        bundleAddress: bundle.address,
        userId: bindFor,
        beneficiary: bindAddress.trim(),
      });
      say(`Submitted — ${tx.hash.slice(0, 10)}… Waiting for confirmation.`);
      const receipt = await tx.wait();
      if (receipt?.status === 1) {
        say("Bound on chain.", "success");
        bindFor = "";
        bindingsKey = "";
        void loadBindings(bundle.address, partyIds);
      } else {
        say("The transaction failed on chain.", "error");
      }
    } catch (err: any) {
      if (err?.code === 4001 || err?.code === "ACTION_REJECTED") {
        say("Transaction rejected.", "error");
      } else if (/not authorized/i.test(String(err?.reason ?? err?.message ?? ""))) {
        say("This wallet can't bind that share.", "error");
      } else {
        say(err?.reason ?? err?.shortMessage ?? err?.message ?? "Could not bind.", "error");
      }
    } finally {
      bindBusy = false;
    }
  }

  function reset() {
    interiorPercent = saved.interiorPercent;
    steepness = saved.steepness;
    nzones = saved.nzones;
    zoneOf = { ...saved.zones };
    interiorMode = saved.interiorMode ?? "equation";
    shares = { ...(saved.shares ?? {}) };
    shareText = {};
    say("");
    dispatch("reset");
  }

  // The bundle address is a plain settings read — no wallet, so the panel can
  // say whether there is anything on chain before anyone connects one.
  $: void refreshBundle(holonId, holosphere);
  let lastBundleKey = "";
  async function refreshBundle(id: string, hs: HoloSphere | null) {
    const key = `${id}`;
    if (!id || !hs || key === lastBundleKey) return;
    lastBundleKey = key;
    bundle = await loadBundleRecord(hs, id);
  }

  onMount(async () => {
    // Only reconnect a wallet the browser already authorised — never prompt.
    if (typeof window === "undefined" || !(window as any).ethereum) return;
    try {
      const accounts = await (window as any).ethereum.request({
        method: "eth_accounts",
      });
      if (accounts?.length) await connect();
    } catch {
      // An unavailable wallet is not an error here; the button still offers it.
    }
  });
</script>

<div class="editor" class:open>
  <button
    type="button"
    class="toggle"
    on:click={() => (open = !open)}
    aria-expanded={open}
  >
    <span class="toggle-label">Adjust the split</span>
    <span class="toggle-meta">
      {interiorPercent}% to contributors · {nzones}
      {nzones === 1 ? "reciprocity zone" : "reciprocity zones"}
      {#if changed}<span class="dot" aria-label="unsaved changes"></span>{/if}
    </span>
    <span class="chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
  </button>

  {#if open}
    <div class="body">
      <div class="controls">
        <div class="control">
          <label for="interior-slider">
            Contributors share / reciprocity zones
            <span class="value">{interiorPercent}% / {exteriorPercent}%</span>
          </label>
          <input
            id="interior-slider"
            type="range"
            min="0"
            max="100"
            step="1"
            bind:value={interiorPercent}
          />
          <div class="ends">
            <span>All to reciprocity zones</span>
            <span>All to contributors</span>
          </div>
        </div>

        <div class="control">
          <label for="steepness-slider">
            Reciprocity reach
            <span class="value">{steepness}%</span>
          </label>
          <input
            id="steepness-slider"
            type="range"
            min="0"
            max="100"
            step="1"
            bind:value={steepness}
          />
          <div class="ends">
            <span>Close zones first</span>
            <span>Spread evenly</span>
          </div>
        </div>

        <div class="control zones">
          <label for="zones-count">
            Reciprocity zones
            <span class="value">{nzones}</span>
          </label>
          <div class="stepper">
            <button
              type="button"
              on:click={() => (nzones = Math.max(1, nzones - 1))}
              disabled={nzones <= 1}
              aria-label="One zone fewer">−</button
            >
            <input
              id="zones-count"
              type="number"
              min="1"
              max="10"
              bind:value={nzones}
            />
            <button
              type="button"
              on:click={() => (nzones = Math.min(10, nzones + 1))}
              disabled={nzones >= 10}
              aria-label="One zone more">+</button
            >
          </div>
        </div>
      </div>

      <!-- How the contributors' share is divided among members: by the value
           equation (the scoring every board ranks with), or by hand. A custom
           split starts as a copy of the equation and can be re-copied at any
           time; the same rows go to the Bundle contract on sync. -->
      <div class="split">
        <div class="split-head">
          <span>Contributors share divided</span>
          <div class="mode" role="radiogroup" aria-label="How the contributors share is divided">
            <button
              type="button"
              role="radio"
              aria-checked={interiorMode === "equation"}
              class:on={interiorMode === "equation"}
              on:click={() => setMode("equation")}>By value equation</button
            >
            <button
              type="button"
              role="radio"
              aria-checked={interiorMode === "custom"}
              class:on={interiorMode === "custom"}
              on:click={() => setMode("custom")}>Custom split</button
            >
          </div>
        </div>
        {#if interiorMode === "custom"}
          <p class="muted">
            Enter any numbers — 1, 2, 3 or percentages. Each member's share is
            their number out of the total, so they need not sum to 100.
          </p>
          {#if shareRows.length}
            <div class="shares">
              {#each shareRows as row (row.id)}
                <div class="share">
                  <span class="share-name"
                    >{row.name}
                    {#if row.scored != null}
                      <span class="muted">equation {pct(row.scored)}</span>
                    {/if}</span
                  >
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={row.text}
                    on:input={(e) => setShare(row.id, (e.currentTarget as HTMLInputElement).value)}
                    aria-label="{row.name} share"
                  />
                  <span class="share-unit share-pct">{pct(row.ofTotal)}</span>
                  <button
                    type="button"
                    class="share-remove"
                    on:click={() => removeShare(row.id)}
                    aria-label="Remove {row.name} from the split">✕</button
                  >
                </div>
              {/each}
              <div class="share total">
                <span class="share-name">Total</span>
                <span class="share-sum">{num(sharesTotal)}</span>
                <span class="share-unit share-pct">{pct(sharesTotal > 0 ? 100 : 0)}</span>
                <span class="share-spacer" aria-hidden="true"></span>
              </div>
            </div>
          {:else}
            <p class="muted empty">
              Nobody in the split yet — the equation split stands until someone is entered.
            </p>
          {/if}
          <div class="share-actions">
            {#if addable.length}
              <select bind:value={pick} aria-label="Add a member to the split">
                <option value="">Add a member…</option>
                {#each addable as person (person.id)}
                  <option value={person.id}>{person.name}</option>
                {/each}
              </select>
              <button type="button" class="btn ghost" on:click={addShare} disabled={!pick}>Add</button>
            {/if}
            <button
              type="button"
              class="btn ghost"
              on:click={copyEquation}
              disabled={!Object.keys(equationShares).length}
              title="Replace the split with what the value equation gives today"
              >Copy from value equation</button
            >
          </div>
        {:else}
          <p class="muted">
            Divided by contribution score, as the value equation ranks members today.
          </p>
        {/if}
      </div>

      <!-- What each zone actually receives, as a share of the whole fund, and
           who is in it. Bars scale to the biggest zone so a flat spread still
           reads; an empty zone beside an occupied one is 0% — contract parity. -->
      <p class="muted zones-about">
        {placed
          ? "What each zone actually receives, as a share of the whole fund."
          : "Nobody placed yet — the shape the zones would take."}
      </p>
      <div class="rings">
        {#each zoneShares as share, i (i)}
          {@const names = partnersIn(i + 1)}
          <div class="ring" class:empty={share <= 0} title="Zone {i + 1}: {pct(share)} of the fund{names.length ? ` — ${names.join(', ')}` : ''}">
            <span class="ring-value">{pct(share)}</span>
            <div class="ring-track">
              <div
                class="ring-fill"
                style="height: {maxZoneShare > 0 ? Math.max(3, (share / maxZoneShare) * 100) : 3}%; background: {ZONE_COLORS[
                  i % ZONE_COLORS.length
                ]};"
              ></div>
            </div>
            <span class="ring-label">Z{i + 1}</span>
            <span class="ring-who">{names.length ? names.join(", ") : " "}</span>
          </div>
        {/each}
      </div>

      {#if partners.length}
        <div class="partners">
          <div class="partners-head">
            <span>Partners</span>
            <span class="muted">{placed} of {partners.length} placed</span>
          </div>
          {#each partners as partner (partner.id)}
            <div class="partner">
              <span class="partner-name"
                >{partner.name}
                {#if (zoneOf[partner.id] ?? 0) >= 1}
                  <span class="partner-share">{pct(partnerShare(partner.id))} of the fund</span>
                {/if}</span
              >
              <div class="ring-picker" role="group" aria-label={partner.name}>
                <button
                  type="button"
                  class:on={(zoneOf[partner.id] ?? 0) === 0}
                  on:click={() => setZone(partner.id, 0)}
                  title="Not placed — receives nothing"
                >
                  —
                </button>
                {#each Array(nzones) as _, i (i)}
                  <button
                    type="button"
                    class:on={(zoneOf[partner.id] ?? 0) === i + 1}
                    on:click={() => setZone(partner.id, i + 1)}
                    title="Zone {i + 1} — {pct(zoneShares[i] ?? 0)} of the fund"
                  >
                    {i + 1}
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <p class="muted empty">
          No federated partners yet — the reciprocity zones have nowhere to send
          value until this holon is linked to another.
        </p>
      {/if}

      {#if bundle && connected}
        <!-- ── Who each share is paid to on chain ──────────────────────── -->
        <div class="bindings">
          <div class="bindings-head">
            <span class="bindings-title">Paid on chain to</span>
            <span class="muted">
              The contract pushes each share to the address bound to that
              member; bound to their own Bundle, it is divided again there.
              Only the owner wallet, or the wallet already bound, can bind.
            </span>
          </div>
          {#if !bindings}
            <p class="muted empty">Reading the contract…</p>
          {:else if !parties.length}
            <p class="muted empty">Nobody in the split yet.</p>
          {:else}
            <ul class="bind-list">
              {#each parties as p (p.id)}
                <li class="bind-row">
                  <div class="bind-head">
                    <span class="bind-name">{p.name}</span>
                    <span class="bind-status" class:bound={!!bindings.bound[p.id]}
                      >{boundLabel(bindings, p.id)}</span
                    >
                    <button
                      type="button"
                      class="btn ghost"
                      disabled={bindBusy || !bindings.member[p.id]}
                      aria-expanded={bindFor === p.id}
                      on:click={() => (bindFor === p.id ? (bindFor = "") : openBind(p.id))}
                      >{bindings.bound[p.id] ? "Rebind" : "Bind"}</button
                    >
                  </div>
                  {#if bindFor === p.id}
                    <div class="bind-form">
                      <label class="bind-field">
                        <span class="muted">Pay to</span>
                        <input
                          type="text"
                          spellcheck="false"
                          placeholder="0x…"
                          bind:value={bindAddress}
                        />
                      </label>
                      {#if bindOwnBundle}
                        <button
                          type="button"
                          class="bind-own"
                          class:on={bindToOwnBundle}
                          on:click={() => (bindAddress = bindOwnBundle ?? "")}
                          >{p.name}'s own Bundle — {short(bindOwnBundle)}</button
                        >
                      {/if}
                      {#if bindToOwnBundle}
                        <p class="muted">
                          Divided again on chain across {bindPreflight.nodes} holons.
                        </p>
                        {#each bindPreflight.warnings as w (w)}
                          <p class="bind-warn">
                            {#if w === "loop"}
                              Part of it loops back: {bindPreflight.loops[0]
                                .map((id) => nameOf.get(id) ?? id)
                                .join(" → ")}. That part rests where the loop closes.
                            {:else if w === "large"}
                              {bindPreflight.nodes} holons in one push — a large transaction.
                            {:else}
                              {bindPreflight.depth} hops deep — a large transaction.
                            {/if}
                          </p>
                        {/each}
                      {/if}
                      {#if bindAuthority === "none"}
                        <p class="bind-warn">
                          This wallet can't bind that share.
                          {#if bindings.owner}The owner wallet is {short(bindings.owner)}.{/if}
                        </p>
                      {/if}
                      <div class="buttons">
                        <button
                          type="button"
                          class="btn ghost"
                          disabled={bindBusy}
                          on:click={() => (bindFor = "")}>Cancel</button
                        >
                        <button
                          type="button"
                          class="btn primary"
                          disabled={bindBusy || !bindValid || bindAuthority === "none"}
                          on:click={sendBind}>Bind on chain</button
                        >
                      </div>
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      <div class="actions">
        <div class="chain">
          {#if bundle}
            <span class="muted"
              >Bundle {bundle.address.slice(0, 6)}…{bundle.address.slice(-4)}
              {#if connected && networkName}· {networkName}{/if}</span
            >
          {:else}
            <span class="muted">
              Nothing deployed yet — deploy a bundle in
              <a href="/{holonId}/flow">Flow Management</a>.
            </span>
          {/if}
        </div>

        <div class="buttons">
          <button
            type="button"
            class="btn ghost"
            on:click={reset}
            disabled={!changed || busy}>Reset</button
          >
          <button
            type="button"
            class="btn"
            on:click={save}
            disabled={!changed || busy || !holosphere}
            title="Save off-chain, where every wallet-less surface reads it"
            >Save</button
          >
          {#if bundle}
            {#if connected}
              <button
                type="button"
                class="btn primary"
                on:click={updateOnChain}
                disabled={busy}>Update on chain</button
              >
            {:else}
              <button
                type="button"
                class="btn primary"
                on:click={connect}
                disabled={connecting}
                >{connecting ? "Connecting…" : "Connect wallet"}</button
              >
            {/if}
          {/if}
        </div>
      </div>

      {#if notice}
        <p class="notice {noticeKind}">{notice}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .editor {
    border: 1px solid #1e293b;
    border-radius: 0.6rem;
    background: #131c2e;
    margin-bottom: 0.9rem;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.6rem 0.8rem;
    color: #e2e8f0;
    font-size: 0.875rem;
  }

  .toggle-label {
    font-weight: 500;
  }

  .toggle-meta {
    color: #94a3b8;
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #f59e0b;
  }

  .chev {
    margin-left: auto;
    color: #64748b;
  }

  .body {
    padding: 0 0.8rem 0.8rem;
    display: grid;
    gap: 0.9rem;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 1.2rem;
  }

  .control {
    flex: 1 1 15rem;
    min-width: 12rem;
  }

  .control.zones {
    flex: 0 0 auto;
    min-width: 8rem;
  }

  label {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.8rem;
    color: #cbd5e1;
    margin-bottom: 0.35rem;
  }

  .value {
    color: #5eead4;
    font-variant-numeric: tabular-nums;
  }

  input[type="range"] {
    width: 100%;
    height: 5px;
    border-radius: 3px;
    background: #1e293b;
    appearance: none;
    cursor: pointer;
  }

  input[type="range"]::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #14b8a6;
    border: 2px solid #0f172a;
    cursor: pointer;
  }

  input[type="range"]::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #14b8a6;
    border: 2px solid #0f172a;
    cursor: pointer;
  }

  .ends {
    display: flex;
    justify-content: space-between;
    font-size: 0.7rem;
    color: #64748b;
    margin-top: 0.25rem;
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  .stepper button {
    width: 28px;
    height: 28px;
    border-radius: 0.35rem;
    background: #1e293b;
    color: #e2e8f0;
    font-size: 1rem;
  }

  .stepper button:disabled {
    opacity: 0.4;
  }

  .stepper input {
    width: 44px;
    height: 28px;
    text-align: center;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 0.35rem;
    color: #e2e8f0;
  }

  .zones-about {
    margin: 0 0 0.35rem;
    font-size: 0.72rem;
  }

  .rings {
    display: flex;
    gap: 0.3rem;
    height: 116px;
    padding: 0.4rem;
    background: #0f172a;
    border-radius: 0.4rem;
  }

  .ring {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
  }

  .ring-track {
    flex: 1;
    width: 100%;
    max-width: 14px;
    background: #1e293b;
    border-radius: 0.2rem 0.2rem 0 0;
    display: flex;
    align-items: flex-end;
    overflow: hidden;
  }

  .ring-fill {
    width: 100%;
    min-height: 2px;
    border-radius: 0.2rem 0.2rem 0 0;
    transition: height 0.25s ease;
  }

  .ring-label {
    font-size: 0.6rem;
    color: #94a3b8;
    margin-top: 0.2rem;
  }

  .ring-value {
    font-size: 0.6rem;
    color: #cbd5e1;
    font-variant-numeric: tabular-nums;
    margin-bottom: 0.15rem;
    white-space: nowrap;
  }

  .ring.empty .ring-value {
    color: #64748b;
  }

  .ring.empty .ring-fill {
    opacity: 0.3;
  }

  .ring-who {
    font-size: 0.55rem;
    color: #94a3b8;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-height: 0.8rem;
  }

  .partner-share {
    margin-left: 0.4rem;
    font-size: 0.72rem;
    color: #5eead4;
    font-variant-numeric: tabular-nums;
  }

  .partners {
    display: grid;
    gap: 0.35rem;
  }

  .partners-head {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: #cbd5e1;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .partner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.3rem 0.4rem;
    border-radius: 0.4rem;
    background: #0f172a;
  }

  .partner-name {
    font-size: 0.85rem;
    color: #e2e8f0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ring-picker {
    display: flex;
    gap: 0.2rem;
    flex-wrap: wrap;
  }

  .ring-picker button {
    min-width: 26px;
    height: 26px;
    border-radius: 0.35rem;
    background: #1e293b;
    color: #94a3b8;
    font-size: 0.78rem;
  }

  .ring-picker button.on {
    background: #0f766e;
    color: #f0fdfa;
  }

  .split {
    display: grid;
    gap: 0.4rem;
  }

  .split-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.75rem;
    color: #cbd5e1;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .mode {
    display: flex;
    gap: 0.2rem;
    text-transform: none;
    letter-spacing: 0;
  }

  .mode button {
    padding: 0.25rem 0.6rem;
    border-radius: 0.35rem;
    background: #1e293b;
    color: #94a3b8;
    font-size: 0.78rem;
  }

  .mode button.on {
    background: #0f766e;
    color: #f0fdfa;
  }

  .split .muted {
    margin: 0;
  }

  .shares {
    display: grid;
    gap: 0.3rem;
  }

  .share {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.4rem;
    border-radius: 0.4rem;
    background: #0f172a;
  }

  .share-name {
    flex: 1;
    min-width: 0;
    font-size: 0.85rem;
    color: #e2e8f0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .share-name .muted {
    margin-left: 0.4rem;
    font-size: 0.72rem;
  }

  .share input {
    width: 5rem;
    padding: 0.25rem 0.4rem;
    border-radius: 0.35rem;
    background: #1e293b;
    color: #e2e8f0;
    font-size: 0.82rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .share-unit {
    color: #64748b;
    font-size: 0.78rem;
  }

  .share-pct {
    min-width: 3.2rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .share-remove {
    width: 26px;
    height: 26px;
    border-radius: 0.35rem;
    background: #1e293b;
    color: #94a3b8;
    font-size: 0.75rem;
  }

  .share-spacer {
    width: 26px;
    flex: 0 0 26px;
  }

  .share.total {
    background: transparent;
    border-top: 1px solid #1e293b;
    border-radius: 0;
  }

  .share-sum {
    font-size: 0.85rem;
    color: #5eead4;
    font-variant-numeric: tabular-nums;
  }


  .share-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .share-actions select {
    padding: 0.35rem 0.5rem;
    border-radius: 0.4rem;
    background: #1e293b;
    color: #e2e8f0;
    font-size: 0.82rem;
    max-width: 14rem;
  }

  .muted {
    color: #64748b;
    font-size: 0.78rem;
  }

  .muted a {
    color: #5eead4;
    text-decoration: underline;
  }

  .empty {
    margin: 0;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding-top: 0.6rem;
    border-top: 1px solid #1e293b;
  }

  .buttons {
    display: flex;
    gap: 0.5rem;
    margin-left: auto;
  }

  /* ── Bindings ───────────────────────────────────────────────────────── */
  .bindings {
    margin: 1rem 0 0.4rem;
    padding-top: 0.8rem;
    border-top: 1px solid #1e293b;
  }
  .bindings-head {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 0.4rem;
  }
  .bindings-title {
    color: #e2e8f0;
    font-size: 0.85rem;
    font-weight: 500;
  }
  .bind-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .bind-row {
    border-top: 1px solid #1e293b;
    padding: 0.45rem 0;
  }
  .bind-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "name btn"
      "status btn";
    align-items: center;
    column-gap: 0.6rem;
  }
  .bind-name {
    grid-area: name;
    color: #e2e8f0;
    font-size: 0.85rem;
    font-weight: 500;
  }
  .bind-status {
    grid-area: status;
    color: #94a3b8;
    font-size: 0.78rem;
  }
  .bind-status.bound {
    color: #5eead4;
  }
  .bind-head .btn {
    grid-area: btn;
  }
  .bind-form {
    padding: 0.4rem 0 0.2rem;
  }
  .bind-field {
    display: block;
  }
  .bind-field input {
    display: block;
    width: 100%;
    margin-top: 0.25rem;
    padding: 0.45rem 0.6rem;
    font-size: 0.82rem;
    font-family: ui-monospace, monospace;
    color: #e2e8f0;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 0.45rem;
  }
  .bind-own {
    display: block;
    width: 100%;
    margin-top: 0.4rem;
    padding: 0.4rem 0.6rem;
    text-align: left;
    font-size: 0.8rem;
    color: #94a3b8;
    background: transparent;
    border: 1px solid #334155;
    border-radius: 0.45rem;
  }
  .bind-own.on {
    color: #5eead4;
    border-color: #0f766e;
  }
  .bind-warn {
    margin: 0.4rem 0 0;
    font-size: 0.8rem;
    color: #fbbf24;
  }
  .bind-form .buttons {
    margin-top: 0.5rem;
  }

  .btn {
    padding: 0.4rem 0.9rem;
    border-radius: 0.45rem;
    background: #1e293b;
    color: #e2e8f0;
    font-size: 0.82rem;
  }

  .btn.ghost {
    background: transparent;
    border: 1px solid #334155;
    color: #94a3b8;
  }

  .btn.primary {
    background: #0f766e;
    color: #f0fdfa;
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .notice {
    margin: 0;
    font-size: 0.8rem;
    color: #94a3b8;
  }

  .notice.error {
    color: #fca5a5;
  }

  .notice.success {
    color: #5eead4;
  }
</style>
