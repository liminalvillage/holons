<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The allocation split, editable where it is read — the kiosk's take on the
  // dashboard's AllocationEditor. Move a slider, place a partner — or a
  // person — on a ring, point the holon at its OpenCollective collective; Save writes the settings
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
    allocate,
    saveAllocationConfig,
    saveCollectiveSlug,
    type AllocationConfig,
  } from "@holons/core/flows";
  import Modal from "./Modal.svelte";

  export let holonId = "";
  export let config: AllocationConfig;
  export let zones: Record<string, number> = {};
  export let partners: { id: string; name: string }[] = [];
  /** People placed on rings, by user id (settings `allocation.people`). */
  export let zonePeople: Record<string, number> = {};
  /** Everyone who could be placed: the holon's roster, the holon itself excluded. */
  export let candidates: { id: string; name: string }[] = [];
  export let collectiveSlug = "";

  const dispatch = createEventDispatcher<{ close: void; saved: void }>();

  // A draft, so Cancel costs nothing and Save writes once.
  let interiorPercent = config.interiorPercent;
  let steepness = config.steepness;
  let nzones = config.nzones;
  let zoneOf: Record<string, number> = { ...zones };
  let personZone: Record<string, number> = { ...zonePeople };
  // The picker's choice; placing it moves the person into the list below.
  let pick = "";
  let slug = collectiveSlug;
  let busy = false;
  let error = "";

  $: exteriorPercent = 100 - interiorPercent;
  // A partner on a ring the count no longer reaches falls to the outermost.
  $: for (const id of Object.keys(zoneOf)) {
    if (zoneOf[id] > nzones) zoneOf[id] = nzones;
  }
  $: for (const id of Object.keys(personZone)) {
    if (personZone[id] > nzones) personZone[id] = nzones;
  }
  // The people on rings, named from the roster; a placed id the roster no
  // longer knows keeps its id so it can still be removed.
  $: nameOfPerson = new Map(candidates.map((c) => [c.id, c.name]));
  $: placedPeople = Object.entries(personZone)
    .filter(([, zone]) => zone >= 1)
    .map(([id]) => ({ id, name: nameOfPerson.get(id) ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name));
  $: unplaced = candidates
    .filter(
      (c) => !(personZone[c.id] >= 1) && !partners.some((p) => p.id === c.id),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  // What each zone — and each partner in it — actually receives, as a share
  // of the WHOLE fund: the draft run through the same `allocate()` the Sankey
  // draws and the Bundle contract pays by. An empty zone next to an occupied
  // one shows 0%, because that is what the chain would send it; with nobody
  // placed at all the zones keep their decay shape as a preview.
  $: draft = allocate({
    total: null,
    config: { interiorPercent, steepness, nzones },
    members: [],
    zoned: [
      ...partners.map((p) => ({ ...p, zone: zoneOf[p.id] ?? 0 })),
      ...placedPeople.map((p) => ({
        ...p,
        zone: personZone[p.id],
        kind: "person" as const,
      })),
    ],
  });
  $: zoneShares = draft.exterior.map((z) => z.percentage);
  $: maxZoneShare = Math.max(0, ...zoneShares);
  $: anyPlaced =
    partners.some((p) => (zoneOf[p.id] ?? 0) >= 1) || placedPeople.length > 0;
  $: partnerShare = (id: string): number =>
    draft.exterior.flatMap((z) => z.members ?? []).find((m) => m.id === id)
      ?.percentage ?? 0;
  $: rings = Array.from({ length: nzones }, (_, i) => i + 1);
  const pct = (v: number) => `${Math.round(v * 10) / 10}`;

  function place(id: string, zone: number) {
    zoneOf = { ...zoneOf, [id]: zoneOf[id] === zone ? 0 : zone };
  }

  function placePerson(id: string, zone: number) {
    personZone = { ...personZone, [id]: zone };
  }

  function removePerson(id: string) {
    const next = { ...personZone };
    delete next[id];
    personZone = next;
  }

  /** The picker: choosing someone seats them on the first ring at once. */
  function addPerson() {
    if (!pick) return;
    placePerson(pick, 1);
    pick = "";
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
        personZone,
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
      <p class="sub">
        {anyPlaced ? $t("alloc.zonesAbout") : $t("alloc.zonesPreview")}
      </p>
      <div class="stepper">
        <button
          on:click={() => (nzones = Math.max(1, nzones - 1))}
          disabled={nzones <= 1}
          aria-label={$t("alloc.fewer")}>−</button
        >
        <!-- The zones, each as tall as its share of the whole fund, scaled to
             the biggest so a flat spread still reads. -->
        <div class="rings">
          {#each zoneShares as share, i (i)}
            <div
              class="ring"
              class:empty={share <= 0}
              title={$t("alloc.zoneShare", { pct: pct(share) })}
            >
              <span class="rs">{pct(share)}%</span>
              <div
                class="fill"
                style="height: {maxZoneShare > 0
                  ? Math.max(4, (share / maxZoneShare) * 100)
                  : 4}%"
              ></div>
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
              <span class="pname">
                {p.name}
                {#if (zoneOf[p.id] ?? 0) >= 1}
                  <span class="pshare"
                    >{$t("alloc.zoneShare", {
                      pct: pct(partnerShare(p.id)),
                    })}</span
                  >
                {/if}
              </span>
              <div class="ringpick" role="radiogroup" aria-label={p.name}>
                {#each rings as z (z)}
                  <button
                    role="radio"
                    aria-checked={(zoneOf[p.id] ?? 0) === z}
                    class="rp"
                    class:on={(zoneOf[p.id] ?? 0) === z}
                    on:click={() => place(p.id, z)}
                    title="{$t('flows.tipZoneN', { n: String(z) })} · {$t(
                      'alloc.zoneShare',
                      { pct: pct(zoneShares[z - 1] ?? 0) },
                    )}">{z}</button
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

    <div class="control">
      <div class="k">{$t("alloc.people")}</div>
      <p class="sub">{$t("alloc.peopleAbout")}</p>
      {#if placedPeople.length}
        <ul class="partners">
          {#each placedPeople as p (p.id)}
            <li>
              <span class="pname">
                {p.name}
                <span class="pshare"
                  >{$t("alloc.zoneShare", {
                    pct: pct(partnerShare(p.id)),
                  })}</span
                >
              </span>
              <div class="ringpick" role="radiogroup" aria-label={p.name}>
                {#each rings as z (z)}
                  <button
                    role="radio"
                    aria-checked={personZone[p.id] === z}
                    class="rp"
                    class:on={personZone[p.id] === z}
                    on:click={() => placePerson(p.id, z)}
                    title="{$t('flows.tipZoneN', { n: String(z) })} · {$t(
                      'alloc.zoneShare',
                      { pct: pct(zoneShares[z - 1] ?? 0) },
                    )}">{z}</button
                  >
                {/each}
                <button
                  class="rp remove"
                  on:click={() => removePerson(p.id)}
                  aria-label={$t("alloc.removePerson", { name: p.name })}
                  title={$t("alloc.removePerson", { name: p.name })}>✕</button
                >
              </div>
            </li>
          {/each}
        </ul>
      {/if}
      {#if unplaced.length}
        <div class="picker">
          <select bind:value={pick} aria-label={$t("alloc.addPerson")}>
            <option value="">{$t("alloc.addPerson")}</option>
            {#each unplaced as c (c.id)}
              <option value={c.id}>{c.name}</option>
            {/each}
          </select>
          <button class="add" disabled={!pick} on:click={addPerson}>＋</button>
        </div>
      {:else if !placedPeople.length}
        <p class="sub">{$t("alloc.noPeople")}</p>
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
    height: 4.6rem;
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
  .ring.empty .fill {
    background: var(--muted);
    opacity: 0.25;
  }
  .rn {
    font-size: 0.62rem;
    color: var(--muted);
  }
  .rs {
    font-size: 0.62rem;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .ring.empty .rs {
    color: var(--muted);
  }
  .pshare {
    margin-left: 0.4rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--teal-deep);
    font-variant-numeric: tabular-nums;
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
  .rp.remove {
    color: var(--muted);
  }
  .picker {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .picker select {
    flex: 1;
    min-height: 2.75rem;
    padding: 0.4rem 0.7rem;
    font: inherit;
    color: var(--ink);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 12px;
  }
  .picker .add {
    width: 2.75rem;
    min-height: 2.75rem;
    border-radius: 12px;
    background: var(--teal);
    color: #fff;
    font-size: 1.2rem;
    touch-action: manipulation;
  }
  .picker .add:disabled {
    opacity: 0.4;
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
