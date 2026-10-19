<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Money out: how a holon divides what reaches it. How much it keeps, and
  // who the rest goes to — projects and people placed on rings, an inner
  // ring weighing more than the one outside it.
  //
  // Every figure on screen is core's (`previewDraft`, the same `allocate`
  // the cut pays by), recomputed on each touch; nothing is stored until the
  // changes have been read back and confirmed. Only a steward's save counts
  // — anyone else sees the same screen without the controls.
  import {
    addRecipient,
    draftChanges,
    previewDraft,
    removeRecipient,
    setKeep,
    setRing,
    setRingCount,
    setResourced,
    setSteepness,
    MAX_SPLIT_RINGS,
    type SplitChange,
    type SplitDraft,
    type SplitRecipient,
  } from "@holons/core/flows";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import BottomSheet from "$lib/components/BottomSheet.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import KindChip from "$lib/components/KindChip.svelte";
  import SnapshotStatus from "$lib/components/SnapshotStatus.svelte";
  import { canSteer } from "$lib/account";
  import { currentUser } from "$lib/auth";
  import { pct } from "$lib/format";
  import { index } from "$lib/graph";
  import { t } from "$lib/i18n";
  import { showNotice } from "$lib/notice";
  import { loadSplit, saveSplit } from "$lib/split";
  import { hrefFor } from "$lib/urls";

  $: holon = $page.params.holon ?? "";
  $: node = $index?.byId.get(holon) ?? null;
  $: back = node ? hrefFor(node) : "/";

  let before: SplitDraft | null = null;
  let draft: SplitDraft | null = null;
  let steer = false;
  let state: "loading" | "ready" | "unreadable" = "loading";
  let readFor = "";

  async function read(id: string) {
    state = "loading";
    const [loaded, mayEdit] = await Promise.all([loadSplit(id), canSteer(id)]);
    if (id !== holon) return;
    before = loaded;
    draft = loaded;
    steer = mayEdit;
    state = loaded ? "ready" : "unreadable";
  }
  // Read again when the account changes: signing in may make this editable.
  $: {
    const key = `${holon}:${$currentUser?.id ?? ""}`;
    if (holon && key !== readFor) {
      readFor = key;
      void read(holon);
    }
  }

  $: preview = draft ? previewDraft(draft) : null;
  $: changes = before && draft ? draftChanges(before, draft) : [];
  $: byRing = (ring: number) =>
    (preview?.rows ?? []).filter((r) => r.ring === ring);
  $: ringShare = (ring: number) =>
    preview?.rings.find((r) => r.ring === ring)?.percentage ?? 0;

  let adding = false;
  let query = "";
  $: candidates = (draft?.candidates ?? []).filter((c) =>
    c.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  let reviewing = false;
  let saving = false;
  let error = "";

  const edit = (next: SplitDraft) => {
    if (steer) draft = next;
  };
  const kindOf = (r: SplitRecipient) =>
    $index?.byId.get(r.id)?.kind ??
    (r.kind === "person" ? "person" : "project");

  const describe = (c: SplitChange): string => {
    switch (c.kind) {
      case "keep":
        return $t("split.change.keep", { from: c.from, to: c.to });
      case "rings":
        return $t("split.change.rings", { from: c.from, to: c.to });
      case "steepness":
        return $t("split.change.slope", { from: c.from, to: c.to });
      case "resourced":
        return $t("split.change.resourced", { from: c.from, to: c.to });
      case "added":
        return $t("split.change.added", { name: c.name, ring: c.ring });
      case "moved":
        return $t("split.change.moved", {
          name: c.name,
          from: c.from,
          to: c.to,
        });
      case "removed":
        return $t("split.change.removed", { name: c.name });
    }
  };

  async function save() {
    if (!draft) return;
    saving = true;
    error = "";
    try {
      await saveSplit(holon, draft);
      before = draft;
      reviewing = false;
      showNotice($t("split.saved"));
      void goto(back);
    } catch (err) {
      error = /locked/i.test((err as Error)?.message ?? "")
        ? $t("split.lockedError")
        : $t("claim.failed");
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head
  ><title>{node ? `${node.label} · ${$t("split.title")}` : "Flows"}</title
  ></svelte:head
>

<SnapshotStatus />

<header class="head">
  <a class="backlink" href={back}
    ><Icon name="arrow-left" />{node?.label ?? ""}</a
  >
  <h1>{$t("split.title")}</h1>
  <p class="muted">{$t("split.lead")}</p>
</header>

{#if state === "loading"}
  <p class="muted">{$t("fund.reading")}</p>
{:else if state === "unreadable" || !draft || !preview}
  <p class="notice warn">{$t("split.unreadable")}</p>
{:else}
  {#if !steer}
    <p class="notice">
      {$currentUser ? $t("split.notSteward") : $t("split.signIn")}
    </p>
  {/if}

  <div
    class="bar"
    role="img"
    aria-label={$t("split.barLabel", {
      keep: pct(preview.keep + preview.unplaced),
      out: pct(preview.passed),
    })}
  >
    {#if preview.keep + preview.unplaced > 0}
      <span class="seg keep" style="flex:{preview.keep + preview.unplaced}"
      ></span>
    {/if}
    {#each preview.rings as ring (ring.ring)}
      {#if ring.percentage > 0}
        <span
          class="seg"
          style="flex:{ring.percentage};opacity:{1 - (ring.ring - 1) * 0.16}"
        ></span>
      {/if}
    {/each}
  </div>
  <p class="legend">
    <span
      ><i class="dot keep"></i>{$t("split.kept")}
      {pct(preview.keep + preview.unplaced)}</span
    >
    <span><i class="dot"></i>{$t("split.passedOn")} {pct(preview.passed)}</span>
  </p>
  {#if preview.unplaced > 0.005}
    <p class="notice warn">
      {$t("split.unplaced", { pct: pct(preview.unplaced) })}
    </p>
  {/if}

  <section class="card knobs">
    <label class="knob">
      <span class="k">{$t("split.keepLabel")}<b>{draft.keep}%</b></span>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={draft.keep}
        disabled={!steer || draft.locked}
        on:input={(e) => edit(setKeep(draft!, Number(e.currentTarget.value)))}
      />
      {#if draft.locked}
        <small>{$t("split.keepLocked")}</small>
      {/if}
    </label>

    <div class="knob">
      <span class="k">{$t("split.rings")}<b>{draft.nzones}</b></span>
      <div class="stepper">
        <button
          aria-label={$t("split.fewerRings")}
          disabled={!steer || draft.nzones <= 1}
          on:click={() => edit(setRingCount(draft!, draft!.nzones - 1))}
          ><Icon name="minus" /></button
        >
        <button
          aria-label={$t("split.moreRings")}
          disabled={!steer || draft.nzones >= MAX_SPLIT_RINGS}
          on:click={() => edit(setRingCount(draft!, draft!.nzones + 1))}
          ><Icon name="plus" /></button
        >
      </div>
    </div>

    {#if draft.nzones > 1}
      <label class="knob">
        <span class="k">{$t("split.slope")}<b>{draft.steepness}</b></span>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={draft.steepness}
          disabled={!steer}
          on:input={(e) =>
            edit(setSteepness(draft!, Number(e.currentTarget.value)))}
        />
        <small>{$t("split.slopeHint")}</small>
      </label>
    {/if}

    <label class="knob">
      <span class="k">{$t("split.resourced")}<b>{draft.resourced}%</b></span>
      <input
        type="range"
        min="0"
        max="100"
        step="5"
        value={draft.resourced}
        disabled={!steer}
        on:input={(e) =>
          edit(setResourced(draft!, Number(e.currentTarget.value)))}
      />
      <small>{$t("split.resourcedHint")}</small>
    </label>
  </section>

  {#each Array.from({ length: draft.nzones }, (_, i) => i + 1) as ring (ring)}
    {@const rows = byRing(ring)}
    <h2 class="section-title">
      {$t("split.ring", { n: ring })} · {pct(ringShare(ring))}
    </h2>
    {#if rows.length}
      <ul class="rows">
        {#each rows as r (r.id)}
          <li>
            <span class="who">
              <b>{r.name}</b>
              <span class="meta">
                <KindChip kind={kindOf(r)} />
                {#if !r.federated}
                  <i class="flag">{$t("split.notLinked")}</i>
                {/if}
              </span>
            </span>
            <span class="n">{pct(r.percentage)}</span>
            {#if steer}
              <span class="move">
                <button
                  aria-label={$t("split.moveIn", { name: r.name })}
                  disabled={ring <= 1}
                  on:click={() => edit(setRing(draft!, r.id, ring - 1))}
                  ><Icon name="minus" /></button
                >
                <button
                  aria-label={$t("split.moveOut", { name: r.name })}
                  disabled={ring >= draft.nzones}
                  on:click={() => edit(setRing(draft!, r.id, ring + 1))}
                  ><Icon name="plus" /></button
                >
                <button
                  class="x"
                  aria-label={$t("split.remove", { name: r.name })}
                  on:click={() => edit(removeRecipient(draft!, r.id))}
                  ><Icon name="close" /></button
                >
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted empty">{$t("split.ringEmpty")}</p>
    {/if}
  {/each}

  {#if steer}
    <button class="btn quiet wide add" on:click={() => (adding = true)}
      ><Icon name="plus" />{$t("split.add")}</button
    >
    <div class="save">
      <button
        class="btn wide"
        disabled={!changes.length}
        on:click={() => (reviewing = true)}
      >
        {changes.length
          ? $t("split.review", { n: changes.length })
          : $t("split.noChanges")}
      </button>
    </div>
  {/if}
{/if}

{#if adding && draft}
  <BottomSheet title={$t("split.add")} on:close={() => (adding = false)}>
    <p class="muted">{$t("split.addLead")}</p>
    <label class="sr-only" for="find-recipient">{$t("nav.search")}</label>
    <input
      id="find-recipient"
      class="text"
      bind:value={query}
      placeholder={$t("nav.search")}
      autocomplete="off"
    />
    {#if candidates.length}
      <ul class="rows sheet-rows">
        {#each candidates.slice(0, 60) as c (c.id)}
          <li>
            <button
              class="cand"
              on:click={() => {
                edit(addRecipient(draft!, c));
                adding = false;
                query = "";
              }}
            >
              <span class="who">
                <b>{c.name}</b>
                <span class="meta"><KindChip kind={kindOf(c)} /></span>
              </span>
              <Icon name="plus" />
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted empty">{$t("split.noCandidates")}</p>
    {/if}
  </BottomSheet>
{/if}

{#if reviewing}
  <BottomSheet
    title={$t("split.reviewTitle")}
    on:close={() => (reviewing = false)}
  >
    <ul class="changes">
      {#each changes as c, i (i)}
        <li>{describe(c)}</li>
      {/each}
    </ul>
    <p class="muted small-print">{$t("split.takesEffect")}</p>
    {#if error}<p class="notice warn" role="alert">{error}</p>{/if}
    <div class="row">
      <button
        class="btn quiet"
        on:click={() => (reviewing = false)}
        disabled={saving}>{$t("nav.back")}</button
      >
      <button class="btn grow" on:click={save} disabled={saving}
        >{saving ? $t("split.saving") : $t("split.save")}</button
      >
    </div>
  </BottomSheet>
{/if}

<style>
  .head {
    display: grid;
    gap: 4px;
    margin-bottom: 14px;
  }
  .head h1 {
    font-size: 1.5rem;
    line-height: 1.2;
  }
  .backlink {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 40px;
    font-weight: 700;
    font-size: 0.9rem;
    color: var(--teal-ink);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  .bar {
    display: flex;
    height: 22px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--line);
    margin-top: 12px;
  }
  .seg {
    background: var(--teal);
    min-width: 2px;
  }
  .seg + .seg {
    border-left: 2px solid var(--card);
  }
  .seg.keep,
  .dot.keep {
    background: var(--kind-person, var(--ink-soft));
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 18px;
    margin: 8px 0 4px;
    font-size: 0.88rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-right: 6px;
    background: var(--teal);
  }
  .knobs {
    display: grid;
    gap: 16px;
    margin-top: 12px;
  }
  .knob {
    display: grid;
    gap: 6px;
  }
  .k {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-weight: 600;
  }
  .k b {
    font-variant-numeric: tabular-nums;
  }
  .knob small {
    font-size: 0.8rem;
    color: var(--muted);
  }
  input[type="range"] {
    width: 100%;
    height: 44px;
    accent-color: var(--teal);
  }
  .stepper,
  .move {
    display: inline-flex;
    gap: 6px;
  }
  .stepper button,
  .move button {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.1rem;
    color: var(--ink);
    background: var(--card);
  }
  .stepper button:disabled,
  .move button:disabled {
    opacity: 0.35;
  }
  .move .x {
    border-color: transparent;
    color: var(--muted);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .rows li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 60px;
    padding: 8px 8px 8px 14px;
  }
  .rows li + li {
    border-top: 1px solid var(--line);
  }
  .who {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
  }
  .who b {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .flag {
    font-style: normal;
    font-size: 0.74rem;
    font-weight: 700;
    color: var(--caution);
  }
  .n {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .empty {
    font-size: 0.9rem;
    padding: 4px 2px;
  }
  .wide {
    width: 100%;
  }
  .add {
    margin-top: 18px;
  }
  .save {
    position: sticky;
    bottom: calc(var(--nav-h) + env(safe-area-inset-bottom) + 10px);
    margin-top: 12px;
    z-index: 5;
  }
  .text {
    width: 100%;
    min-height: var(--tap);
    margin: 10px 0;
    padding: 0 14px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 16px;
  }
  .sheet-rows li {
    padding: 0;
  }
  .cand {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 60px;
    padding: 8px 14px;
    font: inherit;
    color: var(--ink);
  }
  .changes {
    margin: 0;
    padding-left: 20px;
    display: grid;
    gap: 6px;
  }
  .small-print {
    font-size: 0.84rem;
    margin-top: 12px;
  }
  .row {
    display: flex;
    gap: 10px;
    margin-top: 14px;
  }
  .grow {
    flex: 1 1 auto;
  }
</style>
