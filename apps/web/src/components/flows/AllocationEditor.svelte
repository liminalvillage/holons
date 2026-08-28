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
  import { calculateZonePercentages } from "@holons/core/flows";
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
  $: zonePercentages = calculateZonePercentages(steepness, nzones);
  $: placed = partners.filter((p) => (zoneOf[p.id] ?? 0) >= 1).length;

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
      {interiorPercent}% interior · {nzones}
      {nzones === 1 ? "zone" : "zones"}
      {#if changed}<span class="dot" aria-label="unsaved changes"></span>{/if}
    </span>
    <span class="chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
  </button>

  {#if open}
    <div class="body">
      <div class="controls">
        <div class="control">
          <label for="interior-slider">
            Interior / exterior
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
            <span>All exterior</span>
            <span>All interior</span>
          </div>
        </div>

        <div class="control">
          <label for="steepness-slider">
            Exterior sharing
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
            <span>Steep — the inner ring takes it</span>
            <span>Even</span>
          </div>
        </div>

        <div class="control zones">
          <label for="zones-count">
            Zones
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

      <!-- What the steepness slider actually does, ring by ring. -->
      <div class="rings">
        {#each zonePercentages as percent, i (i)}
          <div class="ring">
            <div class="ring-track">
              <div
                class="ring-fill"
                style="height: {percent}%; background: {ZONE_COLORS[
                  i % ZONE_COLORS.length
                ]};"
              ></div>
            </div>
            <span class="ring-label">Z{i + 1}</span>
            <span class="ring-value">{percent.toFixed(1)}%</span>
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
              <span class="partner-name">{partner.name}</span>
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
                    title="Zone {i + 1} — {zonePercentages[i]?.toFixed(1) ??
                      0}% of the exterior share"
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
          No federated partners yet — the exterior share has nowhere to go until
          this holon is linked to another.
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

  .rings {
    display: flex;
    gap: 0.3rem;
    height: 88px;
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
    font-size: 0.55rem;
    color: #64748b;
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
