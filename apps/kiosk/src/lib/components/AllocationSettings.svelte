<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The allocation split, editable where it is read — the kiosk's take on the
  // dashboard's AllocationEditor. Move a slider, place a partner on a ring,
  // point the holon at its OpenCollective collective; Save writes the settings
  // lens through core (`saveAllocationConfig` / `saveCollectiveSlug`), which
  // is exactly what the Flows board and Flow Management read back. No wallet
  // here: pushing the split on-chain stays with Flow Management.
  //
  // Writes go through `getReaStore`, so the acting identity is the logged-in
  // user, signed by the device key — the caller gates on login first.

  import { createEventDispatcher } from "svelte";
  import { t } from "$lib/i18n";
  import { getReaStore } from "$lib/holosphere";
  import {
    calculateZonePercentages,
    saveAllocationConfig,
    saveCollectiveSlug,
    type AllocationConfig,
  } from "@holons/core/flows";
  import Modal from "./Modal.svelte";

  export let holonId = "";
  export let config: AllocationConfig;
  export let zones: Record<string, number> = {};
  export let partners: { id: string; name: string }[] = [];
  export let collectiveSlug = "";

  const dispatch = createEventDispatcher<{ close: void; saved: void }>();

  // A draft, so Cancel costs nothing and Save writes once.
  let interiorPercent = config.interiorPercent;
  let steepness = config.steepness;
  let nzones = config.nzones;
  let zoneOf: Record<string, number> = { ...zones };
  let slug = collectiveSlug;
  let busy = false;
  let error = "";

  $: exteriorPercent = 100 - interiorPercent;
  // A partner on a ring the count no longer reaches falls to the outermost.
  $: for (const id of Object.keys(zoneOf)) {
    if (zoneOf[id] > nzones) zoneOf[id] = nzones;
  }
  // What the sharing slider does, ring by ring — the same core arithmetic the
  // Sankey (and the Bundle contract) split by.
  $: ringShares = calculateZonePercentages(steepness, nzones);
  $: rings = Array.from({ length: nzones }, (_, i) => i + 1);

  function place(id: string, zone: number) {
    zoneOf = { ...zoneOf, [id]: zoneOf[id] === zone ? 0 : zone };
  }

  async function save() {
    if (busy) return;
    busy = true;
    error = "";
    try {
      const store = await getReaStore();
      await saveAllocationConfig(
        store,
        holonId,
        { interiorPercent, steepness, nzones },
        zoneOf,
      );
      if (slug.trim() !== collectiveSlug) {
        await saveCollectiveSlug(store, holonId, slug.trim());
      }
      dispatch("saved");
      dispatch("close");
    } catch (err: any) {
      const denied =
        err?.name === "AuthorizationError" ||
        /denied|unauthori[sz]ed|permission/i.test(String(err?.message ?? ""));
      error = denied ? $t("alloc.errDenied") : $t("alloc.errSave");
      if (!denied) console.error("[kiosk] allocation save failed", err);
    } finally {
      busy = false;
    }
  }
</script>

<Modal on:close={() => dispatch("close")}>
  <div class="sheet">
    <h3>{$t("alloc.settings")}</h3>

    <label class="field">
      <span class="k">{$t("alloc.collective")}</span>
      <input
        type="text"
        autocapitalize="none"
        placeholder={$t("alloc.collectiveHint")}
        bind:value={slug}
      />
    </label>

    <div class="control">
      <label for="alloc-interior" class="k">
        {$t("alloc.interior")}
        <span class="value">{interiorPercent}% / {exteriorPercent}%</span>
      </label>
      <input
        id="alloc-interior"
        type="range"
        min="0"
        max="100"
        step="1"
        bind:value={interiorPercent}
      />
      <div class="ends">
        <span>{$t("alloc.allExterior")}</span>
        <span>{$t("alloc.allInterior")}</span>
      </div>
    </div>

    <div class="control">
      <label for="alloc-steep" class="k">
        {$t("alloc.sharing")}
        <span class="value">{steepness}%</span>
      </label>
      <input
        id="alloc-steep"
        type="range"
        min="0"
        max="100"
        step="1"
        bind:value={steepness}
      />
      <div class="ends">
        <span>{$t("alloc.steep")}</span>
        <span>{$t("alloc.even")}</span>
      </div>
    </div>

    <div class="control">
      <div class="k">
        {$t("alloc.zones")}
        <span class="value">{nzones}</span>
      </div>
      <div class="stepper">
        <button
          on:click={() => (nzones = Math.max(1, nzones - 1))}
          disabled={nzones <= 1}
          aria-label={$t("alloc.fewer")}>−</button
        >
        <!-- The rings, each as tall as its share of the exterior. -->
        <div class="rings" aria-hidden="true">
          {#each ringShares as pct, i (i)}
            <div class="ring">
              <div class="fill" style="height: {Math.max(4, pct)}%"></div>
              <span class="rn">{i + 1}</span>
            </div>
          {/each}
        </div>
        <button
          on:click={() => (nzones = Math.min(10, nzones + 1))}
          disabled={nzones >= 10}
          aria-label={$t("alloc.more")}>+</button
        >
      </div>
    </div>

    <div class="control">
      <div class="k">{$t("alloc.partners")}</div>
      {#if partners.length}
        <p class="sub">{$t("alloc.partnersAbout")}</p>
        <ul class="partners">
          {#each partners as p (p.id)}
            <li>
              <span class="pname">{p.name}</span>
              <div class="ringpick" role="radiogroup" aria-label={p.name}>
                {#each rings as z (z)}
                  <button
                    role="radio"
                    aria-checked={(zoneOf[p.id] ?? 0) === z}
                    class="rp"
                    class:on={(zoneOf[p.id] ?? 0) === z}
                    on:click={() => place(p.id, z)}
                    title={$t("flows.tipZoneN", { n: String(z) })}>{z}</button
                  >
                {/each}
                {#if !(zoneOf[p.id] ?? 0)}
                  <span class="unplaced">{$t("alloc.unplaced")}</span>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="sub">{$t("alloc.noPartners")}</p>
      {/if}
    </div>

    {#if error}<p class="error">{error}</p>{/if}
    <div class="actions">
      <button class="ghost" on:click={() => dispatch("close")}
        >{$t("common.cancel")}</button
      >
      <button class="primary" disabled={busy} on:click={save}>
        {busy ? $t("common.saving") : $t("alloc.save")}
      </button>
    </div>
  </div>
</Modal>

<style>
  .sheet {
    padding: 0.2rem 0.1rem;
    min-width: min(22rem, 80vw);
  }
  h3 {
    margin: 0 0 0.3rem;
    padding-right: 2.5rem;
    font-size: 1.15rem;
    color: var(--ink);
  }
  .k {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.6rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .value {
    font-size: 0.95rem;
    letter-spacing: 0;
    text-transform: none;
    color: var(--ink);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .sub {
    margin: 0.2rem 0 0.4rem;
    font-size: 0.82rem;
    color: var(--muted);
  }
  .field {
    display: block;
    margin: 0.8rem 0 0;
  }
  .field input {
    display: block;
    width: 100%;
    margin-top: 0.3rem;
    padding: 0.7rem 0.8rem;
    font-size: 1rem;
    font-family: inherit;
    color: var(--ink);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 12px;
    min-height: 3rem;
  }
  .field input:focus {
    outline: none;
    border-color: var(--teal);
  }
  .control {
    margin-top: 1.1rem;
  }
  input[type="range"] {
    width: 100%;
    margin: 0.5rem 0 0.1rem;
    accent-color: var(--teal);
    height: 2.2rem; /* a thumb a finger can find */
  }
  .ends {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.72rem;
    color: var(--muted);
  }
  .stepper {
    display: flex;
    align-items: stretch;
    gap: 0.6rem;
    margin-top: 0.5rem;
  }
  .stepper > button {
    flex: 0 0 auto;
    width: 3rem;
    border-radius: 12px;
    background: var(--paper);
    color: var(--ink);
    font-size: 1.4rem;
    font-weight: 700;
  }
  .stepper > button:disabled {
    opacity: 0.35;
  }
  .rings {
    flex: 1;
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: 3.6rem;
    padding: 0.2rem 0.3rem 0;
    border-radius: 12px;
    background: var(--paper);
  }
  .ring {
    flex: 1;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    gap: 2px;
  }
  .fill {
    width: 100%;
    border-radius: 4px 4px 0 0;
    background: var(--teal);
    opacity: 0.85;
  }
  .rn {
    font-size: 0.62rem;
    color: var(--muted);
  }
  .partners {
    list-style: none;
    margin: 0.3rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }
  .partners li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem 0.8rem;
  }
  .pname {
    font-weight: 700;
    color: var(--ink);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ringpick {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
  }
  .rp {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    background: var(--paper);
    color: var(--ink-soft);
    font-weight: 700;
    touch-action: manipulation;
  }
  .rp.on {
    background: var(--teal);
    color: #fff;
  }
  .unplaced {
    font-size: 0.72rem;
    color: var(--muted);
    margin-left: 0.3rem;
  }
  .error {
    color: #c0392b;
    font-size: 0.88rem;
    margin: 0.6rem 0 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 1.3rem;
  }
  .primary,
  .ghost {
    flex: 1;
    min-width: 8rem;
    min-height: 52px;
    border-radius: 14px;
    font-size: 1rem;
    font-weight: 700;
    transition: transform 0.1s ease;
  }
  .primary {
    background: var(--teal);
    color: #fff;
    box-shadow: var(--shadow-soft);
  }
  .ghost {
    background: rgba(255, 255, 255, 0.5);
    color: var(--ink);
  }
  .primary:active,
  .ghost:active {
    transform: scale(0.97);
  }
  .primary:disabled {
    opacity: 0.6;
  }
</style>
