<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The coordinator's shift plan, editable where it is read. Left: the
  // catalog — add, edit, disable, remove shifts (code, title, times, people
  // needed, days, place), the zone and the horizon, the same fields Elinor's
  // Mini App edits. Right: the wall AS THE KIOSK WILL SHOW IT — the same
  // ShiftNote the board draws, over the live signups — with the gaps made
  // visible: slots the plan expects but nobody has published (ghosts),
  // published shifts nobody has taken (loud), shifts short of hands,
  // shifts the plan no longer expects (stale) and shifts that drifted from
  // the plan. Publish / republish / retract act per note or in one go.
  //
  // The plan is saved on the holon's settings record through core
  // (`saveShiftPlanFor`); occurrences are published by the server under the
  // deployment's coordinator key (`/api/shifts/occurrence`) — the key never
  // reaches this shared screen.

  import { createEventDispatcher, onMount } from "svelte";
  import { get } from "svelte/store";
  import { t, locale } from "$lib/i18n";
  import {
    now,
    rawShifts,
    shiftIdentity,
    shiftNames,
    showNotice,
  } from "$lib/stores";
  import {
    occurrenceInputOf,
    groupCoverageByDay,
    planCoverage,
    publishShiftOccurrences,
    retractShiftOccurrences,
    saveShiftPlanFor,
    shiftCoordinator,
    shiftPlan,
    shiftPlanLoaded,
  } from "$lib/shifts";
  import { resolveShiftCoordinator } from "$lib/config";
  import {
    defaultShiftPlan,
    isValidTimeZone,
    planFromOccurrences,
    removeShiftDefinition,
    upsertShiftDefinition,
    type ExpectedShift,
    type ShiftDefinition,
    type ShiftOccurrence,
    type ShiftPlan,
  } from "@holons/core/shifts";
  import Modal from "./Modal.svelte";
  import ShiftNote from "./ShiftNote.svelte";

  export let holonId: string;

  const dispatch = createEventDispatcher<{ close: void }>();

  // ── The draft ────────────────────────────────────────────────────────---
  // A copy, so Cancel costs nothing and Save writes once. A holon with no
  // plan yet adopts one from whatever is already on the wall (an Elinor
  // group's occurrences), else starts from Elinor's seed catalog in this
  // screen's zone.
  const browserTz =
    (typeof Intl !== "undefined" &&
      Intl.DateTimeFormat().resolvedOptions().timeZone) ||
    "UTC";
  let draft: ShiftPlan = $shiftPlan
    ? structuredClone($shiftPlan)
    : (planFromOccurrences(get(rawShifts).occurrences, browserTz) ??
      defaultShiftPlan(browserTz));
  let adopted = !$shiftPlan;
  let dirty = false;
  let busy = false;
  let error = "";

  // A plan that arrives after the sheet opened (slow settings read) wins
  // over an untouched adopted draft.
  $: if ($shiftPlanLoaded && $shiftPlan && adopted && !dirty) {
    draft = structuredClone($shiftPlan);
    adopted = false;
  }

  // ── The catalog editor ───────────────────────────────────────────────---
  const DAYS = [1, 2, 3, 4, 5, 6, 7];
  function dayLabel(d: number): string {
    // 2024-01-01 is a Monday; ISO 1..7 → that week.
    return new Date(Date.UTC(2024, 0, d)).toLocaleDateString($locale, {
      weekday: "narrow",
      timeZone: "UTC",
    });
  }

  function patch(code: string, change: Partial<ShiftDefinition>) {
    const cur = draft.shifts.find((s) => s.code === code);
    if (!cur) return;
    const r = upsertShiftDefinition(draft, { ...cur, ...change, code });
    if (!r.ok) {
      error = r.error;
      return;
    }
    error = "";
    draft = r.plan;
    dirty = true;
  }
  function toggleDay(def: ShiftDefinition, d: number) {
    const cur = def.days?.length ? def.days : DAYS;
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d];
    if (!next.length) return; // a shift on no day is "disabled", not "no days"
    patch(def.code, { days: next.length === 7 ? undefined : next });
  }
  function remove(code: string) {
    draft = removeShiftDefinition(draft, code);
    dirty = true;
  }

  // The add form: Elinor's fields, code generated from the title.
  let addOpen = false;
  let nTitle = "";
  let nStart = "09:00";
  let nEnd = "11:00";
  let nCap = 2;
  function add() {
    const r = upsertShiftDefinition(draft, {
      title: nTitle,
      start: nStart,
      end: nEnd,
      capacity: nCap,
    });
    if (!r.ok) {
      error = r.error;
      return;
    }
    error = "";
    draft = r.plan;
    dirty = true;
    nTitle = "";
    addOpen = false;
  }

  let tzInput = draft.tzid;
  $: tzOk = isValidTimeZone(tzInput);
  $: if (tzOk && tzInput !== draft.tzid) {
    draft = { ...draft, tzid: tzInput };
    dirty = true;
  }
  const zones: string[] =
    typeof Intl !== "undefined" &&
    "supportedValuesOf" in Intl &&
    typeof (Intl as any).supportedValuesOf === "function"
      ? ((Intl as any).supportedValuesOf("timeZone") as string[])
      : [];

  // ── The preview ──────────────────────────────────────────────────────---
  // A week of the wall by default; the whole horizon on request. Publish
  // and retract always act over the FULL horizon (what the plan promises),
  // the preview merely shows a slice of it.
  let previewDays = 7;
  $: nowSec = Math.floor($now.getTime() / 1000);
  // The trusted coordinator: a deploy that pins one counts only its
  // occurrences (like the board); otherwise every author's count, so an
  // Elinor group's published shifts are recognised rather than re-published.
  $: trusted = resolveShiftCoordinator() ?? undefined;
  $: ours = $shiftCoordinator?.pubkey;
  $: canPublish = !!$shiftCoordinator?.allowed;
  $: full = planCoverage(
    draft,
    holonId,
    $rawShifts.occurrences,
    $rawShifts.rsvps,
    {
      identity: $shiftIdentity,
      coordinatorPubkey: trusted,
      now: $now,
    },
  );
  $: preview = planCoverage(
    draft,
    holonId,
    $rawShifts.occurrences,
    $rawShifts.rsvps,
    {
      identity: $shiftIdentity,
      coordinatorPubkey: trusted,
      days: previewDays,
      now: $now,
    },
  );
  $: previewDaysRows = groupCoverageByDay(preview.items);
  $: toPublish = full.items.filter(
    (i) => i.expected && (i.state === "unpublished" || i.drifted),
  );
  // Only what OUR coordinator published can be retracted (NIP-09).
  $: retractable = full.items.filter(
    (i) => i.state === "stale" && i.occurrence && i.occurrence.pubkey === ours,
  );

  function dayDate(iso: string): Date {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  }

  // ── Actions ──────────────────────────────────────────────────────────---
  let pending = new Set<string>();
  function mark(key: string, on: boolean) {
    const next = new Set(pending);
    if (on) next.add(key);
    else next.delete(key);
    pending = next;
  }

  async function publishSlots(slots: ExpectedShift[]) {
    if (!slots.length || !canPublish) return;
    const keys = slots.map((e) => e.dTag);
    for (const k of keys) mark(k, true);
    try {
      const { failed } = await publishShiftOccurrences(
        slots.map((e) => occurrenceInputOf(holonId, e)),
      );
      if (failed.length) {
        showNotice(
          $t("shifts.publishPartial", {
            n: failed.length,
            reason: failed[0].error,
          }),
        );
      }
    } catch (err) {
      showNotice(
        $t("shifts.publishFailed", {
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      for (const k of keys) mark(k, false);
    }
  }

  async function retract(occs: ShiftOccurrence[]) {
    if (!occs.length || !canPublish) return;
    const keys = occs.map((o) => o.address);
    for (const k of keys) mark(k, true);
    try {
      await retractShiftOccurrences(occs);
    } catch (err) {
      showNotice(
        $t("shifts.retractFailed", {
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      for (const k of keys) mark(k, false);
    }
  }

  async function save(): Promise<boolean> {
    busy = true;
    error = "";
    try {
      await saveShiftPlanFor(holonId, draft);
      dirty = false;
      adopted = false;
      return true;
    } catch (err: any) {
      const denied =
        err?.name === "AuthorizationError" ||
        /denied|unauthori[sz]ed|permission/i.test(String(err?.message ?? ""));
      error = denied ? $t("shifts.errDenied") : $t("shifts.errSave");
      if (!denied) console.error("[kiosk] shift plan save failed", err);
      return false;
    } finally {
      busy = false;
    }
  }

  /** Save, then publish everything the plan promises and is not on the wall. */
  async function saveAndPublish() {
    if (dirty || adopted) {
      if (!(await save())) return;
    }
    await publishSlots(toPublish.map((i) => i.expected!));
  }

  // Editing the plan while a caretaker scrolls the preview: keep the wall
  // still (the board's rotation hold is the board's; this sheet is modal).
  onMount(() => {
    tzInput = draft.tzid;
  });
</script>

<Modal wide on:close={() => dispatch("close")}>
  <div class="sheet">
    <h3>{$t("shifts.configure")}</h3>
    {#if !$shiftCoordinator}
      <p class="note warn">{$t("shifts.noCoordinator")}</p>
    {:else if !canPublish}
      <p class="note warn">
        {$t("shifts.cannotPublish", {
          reason: $shiftCoordinator.reason ?? "",
        })}
      </p>
    {/if}
    {#if adopted}
      <p class="note">{$t("shifts.adopted")}</p>
    {/if}

    <div class="panes">
      <!-- ── Catalog ─────────────────────────────────────────────────── -->
      <section class="catalog">
        <div class="k">{$t("shifts.catalog")}</div>
        <ul class="defs">
          {#each draft.shifts as def (def.code)}
            <li class="def" class:off={!def.enabled}>
              <div class="line">
                <button
                  type="button"
                  class="switch"
                  class:on={def.enabled}
                  role="switch"
                  aria-checked={def.enabled}
                  aria-label={$t("shifts.enabled")}
                  on:click={() => patch(def.code, { enabled: !def.enabled })}
                >
                  <span class="knob"></span>
                </button>
                <span class="code">{def.code}</span>
                <input
                  class="title"
                  type="text"
                  maxlength="40"
                  value={def.title}
                  aria-label={$t("shifts.title")}
                  on:change={(e) =>
                    patch(def.code, { title: e.currentTarget.value })}
                />
                <button
                  type="button"
                  class="x"
                  aria-label={$t("shifts.remove")}
                  title={$t("shifts.remove")}
                  on:click={() => remove(def.code)}>✕</button
                >
              </div>
              <div class="line">
                <input
                  type="time"
                  value={def.start}
                  aria-label={$t("shifts.start")}
                  on:change={(e) =>
                    patch(def.code, { start: e.currentTarget.value })}
                />
                <span class="dash">–</span>
                <input
                  type="time"
                  value={def.end}
                  aria-label={$t("shifts.end")}
                  on:change={(e) =>
                    patch(def.code, { end: e.currentTarget.value })}
                />
                <label class="cap">
                  <span>{$t("shifts.people")}</span>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={def.capacity}
                    on:change={(e) =>
                      patch(def.code, {
                        capacity: Number(e.currentTarget.value),
                      })}
                  />
                </label>
              </div>
              <div
                class="line days"
                role="group"
                aria-label={$t("shifts.days")}
              >
                {#each DAYS as d (d)}
                  <button
                    type="button"
                    class="day"
                    class:on={!def.days?.length || def.days.includes(d)}
                    aria-pressed={!def.days?.length || def.days.includes(d)}
                    on:click={() => toggleDay(def, d)}>{dayLabel(d)}</button
                  >
                {/each}
                <input
                  class="place"
                  type="text"
                  maxlength="80"
                  placeholder={draft.location
                    ? draft.location
                    : $t("shifts.placeHint")}
                  value={def.location ?? ""}
                  aria-label={$t("shifts.place")}
                  on:change={(e) =>
                    patch(def.code, { location: e.currentTarget.value })}
                />
              </div>
            </li>
          {/each}
        </ul>

        {#if addOpen}
          <div class="def add">
            <div class="line">
              <input
                class="title"
                type="text"
                maxlength="40"
                placeholder={$t("shifts.newTitle")}
                bind:value={nTitle}
              />
            </div>
            <div class="line">
              <input type="time" bind:value={nStart} />
              <span class="dash">–</span>
              <input type="time" bind:value={nEnd} />
              <label class="cap">
                <span>{$t("shifts.people")}</span>
                <input type="number" min="1" max="20" bind:value={nCap} />
              </label>
            </div>
            <div class="line">
              <button
                type="button"
                class="ghost"
                on:click={() => (addOpen = false)}>{$t("common.cancel")}</button
              >
              <button
                type="button"
                class="primary small"
                disabled={!nTitle.trim()}
                on:click={add}>{$t("shifts.add")}</button
              >
            </div>
          </div>
        {:else}
          <button type="button" class="addbtn" on:click={() => (addOpen = true)}
            >＋ {$t("shifts.addShift")}</button
          >
        {/if}

        <div class="k plan">{$t("shifts.planSettings")}</div>
        <div class="line wrap">
          <label class="field">
            <span>{$t("shifts.zone")}</span>
            <input
              type="text"
              list="kiosk-shift-zones"
              class:bad={!tzOk}
              bind:value={tzInput}
              autocapitalize="none"
            />
            {#if zones.length}
              <datalist id="kiosk-shift-zones">
                {#each zones as z (z)}<option value={z}></option>{/each}
              </datalist>
            {/if}
          </label>
          <label class="field">
            <span>{$t("shifts.place")}</span>
            <input
              type="text"
              maxlength="80"
              value={draft.location ?? ""}
              on:change={(e) => {
                const v = e.currentTarget.value.trim();
                draft = v
                  ? { ...draft, location: v }
                  : (({ location: _l, ...rest }) => rest)(draft);
                dirty = true;
              }}
            />
          </label>
          <label class="field narrow">
            <span>{$t("shifts.horizon")}</span>
            <input
              type="number"
              min="1"
              max="60"
              value={draft.horizonDays}
              on:change={(e) => {
                const v = Math.max(
                  1,
                  Math.min(60, Number(e.currentTarget.value) || 14),
                );
                draft = { ...draft, horizonDays: v };
                dirty = true;
              }}
            />
          </label>
        </div>
      </section>

      <!-- ── The wall, as the kiosk will show it ─────────────────────── -->
      <section class="preview">
        <div class="k row">
          <span>{$t("shifts.preview")}</span>
          <span class="range">
            <button
              type="button"
              class:on={previewDays === 7}
              on:click={() => (previewDays = 7)}>{$t("shifts.week")}</button
            >
            <button
              type="button"
              class:on={previewDays !== 7}
              on:click={() => (previewDays = draft.horizonDays)}
              >{$t("shifts.horizonDays", { n: draft.horizonDays })}</button
            >
          </span>
        </div>
        <p class="tally">
          {#if full.summary.unpublished}
            <span class="pill ghost"
              >{$t("shifts.tallyUnpublished", {
                n: full.summary.unpublished,
              })}</span
            >
          {/if}
          {#if full.summary.unstaffed}
            <span class="pill loud"
              >{$t("shifts.unstaffedCount", {
                n: full.summary.unstaffed,
              })}</span
            >
          {/if}
          {#if full.summary.short}
            <span class="pill needs"
              >{$t("shifts.tallyShort", { n: full.summary.short })}</span
            >
          {/if}
          {#if full.summary.covered}
            <span class="pill ok"
              >{$t("shifts.tallyCovered", { n: full.summary.covered })}</span
            >
          {/if}
          {#if full.summary.stale}
            <span class="pill loud"
              >{$t("shifts.tallyStale", { n: full.summary.stale })}</span
            >
          {/if}
          {#if !full.items.length}
            <span class="pill">{$t("shifts.tallyNothing")}</span>
          {/if}
        </p>

        <div class="wall scroll">
          {#each previewDaysRows as day (day.iso)}
            <div class="row">
              <div class="daychip">
                <span class="dow"
                  >{dayDate(day.iso).toLocaleDateString($locale, {
                    weekday: "short",
                  })}</span
                >
                <span class="dom">{dayDate(day.iso).getDate()}</span>
              </div>
              <div class="row-notes">
                {#each day.items as item (item.key)}
                  <ShiftNote
                    occ={item.occurrence ?? null}
                    expected={item.expected ?? null}
                    rsvps={$rawShifts.rsvps}
                    names={$shiftNames}
                    identity={$shiftIdentity}
                    {nowSec}
                    manage={canPublish &&
                      (!item.occurrence || item.occurrence.pubkey === ours)}
                    stale={item.state === "stale"}
                    drifted={item.drifted}
                    busy={pending.has(
                      item.occurrence?.address ??
                        item.expected?.dTag ??
                        item.key,
                    )}
                    on:publish={(e) => publishSlots([e.detail])}
                    on:republish={(e) => publishSlots([e.detail])}
                    on:retract={(e) => retract([e.detail])}
                  />
                {/each}
              </div>
            </div>
          {:else}
            <p class="empty">{$t("shifts.previewEmpty")}</p>
          {/each}
        </div>
      </section>
    </div>

    {#if error}<p class="error">{error}</p>{/if}
    <div class="actions">
      <button class="ghost" type="button" on:click={() => dispatch("close")}
        >{$t("common.cancel")}</button
      >
      {#if canPublish && retractable.length}
        <button
          class="ghost danger"
          type="button"
          disabled={busy}
          on:click={() => retract(retractable.map((i) => i.occurrence!))}
          >{$t("shifts.retractStale", { n: retractable.length })}</button
        >
      {/if}
      <button
        class="ghost"
        type="button"
        disabled={busy || (!dirty && !adopted)}
        on:click={save}
        >{busy ? $t("common.saving") : $t("shifts.savePlan")}</button
      >
      <button
        class="primary"
        type="button"
        disabled={busy ||
          !canPublish ||
          (!toPublish.length && !dirty && !adopted)}
        on:click={saveAndPublish}
        >{toPublish.length
          ? $t("shifts.publishMissing", { n: toPublish.length })
          : $t("shifts.saveAndPublish")}</button
      >
    </div>
  </div>
</Modal>

<style>
  .sheet {
    padding: 0.2rem 0.1rem;
  }
  h3 {
    margin: 0 0 0.3rem;
    padding-right: 2.5rem;
    font-size: 1.15rem;
    color: var(--ink);
  }
  .note {
    margin: 0.2rem 0 0.6rem;
    font-size: 0.82rem;
    color: var(--muted);
  }
  .note.warn {
    color: var(--warn);
    font-weight: 600;
  }
  .k {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.6rem;
    margin: 0.4rem 0 0.4rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .k.plan {
    margin-top: 1rem;
  }

  .panes {
    display: grid;
    grid-template-columns: minmax(18rem, 22rem) 1fr;
    gap: 1.2rem;
    align-items: start;
  }
  @media (max-width: 52rem) {
    .panes {
      grid-template-columns: 1fr;
    }
  }

  /* ── Catalog ── */
  .defs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .def {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.55rem 0.6rem;
    border-radius: 12px;
    background: var(--paper);
  }
  .def.off {
    opacity: 0.55;
  }
  .def.add {
    border: 1.5px dashed var(--line);
    background: transparent;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }
  .line.wrap {
    flex-wrap: wrap;
    align-items: flex-end;
  }
  .code {
    flex: 0 0 auto;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    background: var(--card);
    font-family: ui-monospace, monospace;
    font-size: 0.72rem;
    color: var(--ink-soft);
  }
  input[type="text"],
  input[type="time"],
  input[type="number"] {
    min-width: 0;
    padding: 0.45rem 0.55rem;
    font-size: 0.92rem;
    font-family: inherit;
    color: var(--ink);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 10px;
    min-height: 2.5rem;
  }
  input:focus {
    outline: none;
    border-color: var(--teal);
  }
  input.bad {
    border-color: var(--warn);
  }
  .title {
    flex: 1;
    font-weight: 700;
  }
  input[type="time"] {
    flex: 1;
  }
  .dash {
    color: var(--muted);
  }
  .cap {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.72rem;
    color: var(--muted);
    white-space: nowrap;
  }
  .cap input {
    width: 3.6rem;
  }
  .days {
    flex-wrap: wrap;
  }
  .day {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--muted);
    background: var(--card);
    border: 1.5px solid var(--line);
  }
  .day.on {
    color: #fff;
    background: var(--teal);
    border-color: transparent;
  }
  /* The place rides its own line under the day chips. */
  .place {
    flex: 1 1 100%;
    font-size: 0.8rem;
  }
  .x {
    flex: 0 0 auto;
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 50%;
    color: var(--ink-soft);
    background: var(--card);
  }
  .addbtn {
    margin-top: 0.5rem;
    padding: 0.55rem 0.9rem;
    border-radius: 999px;
    font-weight: 700;
    color: var(--teal);
    background: var(--card);
    border: 1.5px dashed var(--teal);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    flex: 1;
    min-width: 8rem;
    font-size: 0.72rem;
    color: var(--muted);
  }
  .field.narrow {
    flex: 0 0 5rem;
    min-width: 5rem;
  }

  /* The kiosk's switch, same as Settings. */
  .switch {
    flex: 0 0 auto;
    width: 2.6rem;
    height: 1.5rem;
    border-radius: 999px;
    background: var(--line);
    position: relative;
    transition: background 0.15s ease;
  }
  .switch.on {
    background: var(--teal);
  }
  .knob {
    position: absolute;
    top: 0.15rem;
    left: 0.15rem;
    width: 1.2rem;
    height: 1.2rem;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s ease;
  }
  .switch.on .knob {
    transform: translateX(1.1rem);
  }

  /* ── Preview ── */
  .preview {
    min-width: 0;
  }
  .k.row {
    align-items: center;
  }
  .range {
    display: flex;
    gap: 0.25rem;
  }
  .range button {
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: none;
    letter-spacing: 0;
    color: var(--ink-soft);
    background: var(--paper);
  }
  .range button.on {
    color: #fff;
    background: var(--teal);
  }
  .tally {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin: 0 0 0.5rem;
  }
  .pill {
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--ink-soft);
    background: var(--paper);
  }
  .pill.ghost {
    border: 1.5px dashed var(--line);
    background: transparent;
  }
  .pill.loud {
    color: #fff;
    background: var(--warn);
  }
  .pill.needs {
    color: var(--teal-deep);
    background: color-mix(in srgb, var(--teal) 16%, var(--paper));
  }
  .pill.ok {
    color: var(--teal-deep);
  }
  :global([data-theme="dark"]) .pill.needs,
  :global([data-theme="dark"]) .pill.ok {
    color: color-mix(in srgb, var(--teal) 45%, #fff);
  }

  .wall {
    max-height: 56dvh;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0.3rem 0.4rem 0.6rem;
    border-radius: 14px;
    background: var(--paper-deep);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.4rem 0.2rem;
  }
  .daychip {
    flex: 0 0 3rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 0.3rem;
  }
  .dow {
    font-size: 0.66rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .dom {
    font-size: 1.3rem;
    font-weight: 800;
    line-height: 1.1;
    color: var(--ink);
  }
  .row-notes {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.7rem;
    /* The preview notes are the board's, a touch smaller. */
    zoom: 0.92;
  }
  .empty {
    margin: 2rem 1rem;
    text-align: center;
    color: var(--muted);
  }

  .error {
    margin: 0.6rem 0 0;
    color: var(--warn);
    font-size: 0.85rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 1rem;
  }
  .actions button,
  .primary,
  .ghost {
    padding: 0.6rem 1.1rem;
    border-radius: 999px;
    font-weight: 700;
    font-size: 0.9rem;
  }
  .primary {
    color: #fff;
    background: var(--teal);
    box-shadow: var(--shadow-soft);
  }
  .primary.small {
    padding: 0.45rem 0.9rem;
    font-size: 0.82rem;
  }
  .ghost {
    color: var(--ink-soft);
    background: var(--paper);
  }
  .ghost.danger {
    color: var(--warn);
  }
  button:disabled {
    opacity: 0.5;
  }
</style>
