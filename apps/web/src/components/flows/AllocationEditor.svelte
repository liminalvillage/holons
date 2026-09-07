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
    loadBundleRecord,
    mirrorAllocation,
    syncAllocation,
    type SyncMember,
    type SyncPartner,
  } from "../../lib/holons/allocationSync";
  import { allocate } from "@holons/core/flows";
  import { ZONE_COLORS } from "../flow/types";
  import type { HolonBundleRecord } from "@holons/core/flows";

  export let holonId = "";
  export let holosphere: HoloSphere | null = null;

  /** The live draft. Bound, so the diagram above moves with the sliders. */
  export let interiorPercent = 50;
  export let steepness = 50;
  export let nzones = 6;
  /** Partner id → ring. 0 means "not placed in any zone". */
  export let zoneOf: Record<string, number> = {};

  /** Federated partners available to place, names already resolved. */
  export let partners: { id: string; name: string }[] = [];
  /** Interior shares from the contribution scoring, for the on-chain sync. */
  export let members: SyncMember[] = [];
  /** What is currently saved, so "changed" means changed from the record. */
  export let saved: {
    interiorPercent: number;
    steepness: number;
    nzones: number;
    zones: Record<string, number>;
  } = { interiorPercent: 50, steepness: 50, nzones: 6, zones: {} };

  const dispatch = createEventDispatcher<{
    saved: { onChain: boolean };
    reset: void;
  }>();

  let manager: HolonsManager | null = null;
  let bundle: HolonBundleRecord | null = null;
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

  $: changed =
    interiorPercent !== saved.interiorPercent ||
    steepness !== saved.steepness ||
    nzones !== saved.nzones ||
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
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      if (!accounts.length) return;

      const signer = await provider.getSigner();
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
        { interiorPercent, steepness, nzones },
        partnersForSync(),
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
        draft: { interiorPercent, steepness, nzones },
        members,
        partners: partnersForSync(),
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

  function reset() {
    interiorPercent = saved.interiorPercent;
    steepness = saved.steepness;
    nzones = saved.nzones;
    zoneOf = { ...saved.zones };
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
