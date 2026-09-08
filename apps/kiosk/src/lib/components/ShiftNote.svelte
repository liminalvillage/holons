<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // One shift on the wall: a post-it tinted by its shift code, carrying its
  // time, place, who is on it and — the point of a wall display — how many
  // hands it still needs. The SAME note serves the live Shifts board and the
  // coordinator's configuration preview, so what a caretaker sees while
  // planning is exactly what the room will see.
  //
  // Three loud states beyond the ordinary: `running` (now), `unstaffed`
  // (published, nobody on it — the gap the wall exists to show) and `ghost`
  // (the plan expects it, nothing published yet — preview only).
  import { createEventDispatcher } from "svelte";
  import { t } from "$lib/i18n";
  import {
    coverageOf,
    formatShiftTime,
    isEnrolled,
    type ExpectedShift,
    type ShiftIdentityMap,
    type ShiftOccurrence,
    type ShiftRsvp,
  } from "@holons/core/shifts";
  import { isRunningNow, participantNames } from "$lib/shifts";
  import { noteColor, noteTilt } from "$lib/data";

  /** The published occurrence, or null for a planned-but-unpublished slot. */
  export let occ: ShiftOccurrence | null = null;
  /** The plan's slot (drives a ghost note; also tells "drifted" on a live one). */
  export let expected: ExpectedShift | null = null;
  export let rsvps: ShiftRsvp[] = [];
  export let names: Map<string, string> = new Map();
  export let identity: ShiftIdentityMap | undefined = undefined;
  export let nowSec = 0;
  /** Who Take/Drop signs as; null hides them. */
  export let signer: { pubkey: string } | null = null;
  /** Coordinator controls (publish / republish / retract). */
  export let manage = false;
  /** The plan no longer expects this published shift. */
  export let stale = false;
  /** The published shift disagrees with the plan (time, title, place, capacity). */
  export let drifted = false;
  export let busy = false;

  const dispatch = createEventDispatcher<{
    take: ShiftOccurrence;
    drop: ShiftOccurrence;
    publish: ExpectedShift;
    republish: ExpectedShift;
    retract: ShiftOccurrence;
  }>();

  $: ghost = !occ;
  $: code = occ?.code ?? expected?.code ?? "";
  $: seed = occ?.address ?? expected?.dTag ?? code;
  $: title = occ?.title ?? expected?.title ?? code;
  $: location = occ?.location ?? expected?.location;
  $: tzid = occ?.startTzid ?? expected?.tzid;
  $: start = occ?.start ?? expected?.start ?? 0;
  $: end = occ?.end ?? expected?.end ?? 0;
  $: when = `${formatShiftTime(start, tzid)} – ${formatShiftTime(end, tzid)}`;
  $: cov = occ
    ? coverageOf(occ, rsvps, identity)
    : {
        state: "unpublished" as const,
        enrolled: [] as string[],
        missing: expected?.capacity ?? 0,
      };
  $: taken = cov.enrolled.length;
  $: capacity = occ ? occ.capacity : expected?.capacity;
  $: running = !!occ && isRunningNow(occ, nowSec);
  $: mine =
    !!occ && !!signer && isEnrolled(occ, signer.pubkey, rsvps, identity);
  $: who = occ
    ? participantNames(occ, rsvps, names, identity)
    : { shown: [], more: 0 };
  $: unstaffed = cov.state === "unstaffed" && !running;
  $: needy = cov.state === "short" && !running;

  /**
   * The capacity meter: one dot per spot (filled = taken), readable across
   * the room. Past 8 spots dots stop scanning — the "2/12" label carries it.
   */
  const MAX_DOTS = 8;
  function dots(taken: number, capacity: number | undefined): boolean[] {
    const total = capacity ?? taken;
    if (total === 0 || total > MAX_DOTS) return [];
    return Array.from({ length: total }, (_, i) => i < taken);
  }
</script>

<article
  class="shift tilt"
  class:running
  class:mine
  class:needy
  class:unstaffed
  class:ghost
  class:stale
  style="--tilt: {noteTilt(seed)}deg; background: {noteColor(code)};"
  title={occ?.content || title}
>
  <span class="when"
    >{when}{#if running}<span class="live">{$t("shifts.now")}</span
      >{/if}{#if mine}<span class="you">✓ {$t("shifts.youAreOn")}</span
      >{/if}{#if ghost}<span class="flag ghostflag"
        >{$t("shifts.unpublished")}</span
      >{:else if stale}<span class="flag staleflag">{$t("shifts.stale")}</span
      >{:else if drifted}<span class="flag driftflag"
        >{$t("shifts.drifted")}</span
      >{/if}</span
  >
  <span class="ttl">{title}</span>
  {#if location}<span class="where">⌖ {location}</span>{/if}
  {#if taken > 0}
    <span class="who"
      >{who.shown.join(", ")}{#if who.more > 0}
        {$t("shifts.more", { n: who.more })}{/if}</span
    >
  {:else if unstaffed}
    <span class="who nobody">{$t("shifts.nobodyYet")}</span>
  {/if}
  <span class="cap">
    {#if dots(taken, capacity).length}
      <span class="pips" aria-hidden="true">
        {#each dots(taken, capacity) as filled, i (i)}
          <span class="pip" class:filled></span>
        {/each}
      </span>
    {/if}
    {#if ghost}
      <span class="cap-label">{$t("shifts.needs", { n: cov.missing })}</span>
    {:else if capacity === undefined}
      <span class="cap-label">{$t("shifts.signedUp", { n: taken })}</span>
    {:else if cov.missing === 0}
      <span class="cap-label full">{$t("shifts.full")}</span>
    {:else if unstaffed}
      <span class="cap-label needs loud"
        >{$t("shifts.needs", { n: cov.missing })}</span
      >
    {:else}
      <span class="cap-label needs"
        >{$t("shifts.spotsOpen", { n: cov.missing })}</span
      >
    {/if}

    {#if manage}
      <!-- The coordinator's corner: publish a ghost, republish a drifted
           shift so the wall matches the plan, retract what should not be
           there. Retract stays quiet; publish carries the accent. -->
      <span class="tools">
        {#if ghost && expected}
          <button
            class="rsvp take"
            disabled={busy}
            on:click={() => expected && dispatch("publish", expected)}
            >{busy ? "…" : `↑ ${$t("shifts.publish")}`}</button
          >
        {:else if occ}
          {#if drifted && expected}
            <button
              class="rsvp take"
              disabled={busy}
              on:click={() => expected && dispatch("republish", expected)}
              >{busy ? "…" : `↻ ${$t("shifts.republish")}`}</button
            >
          {/if}
          <button
            class="rsvp drop"
            disabled={busy}
            aria-label={$t("shifts.retract")}
            on:click={() => occ && dispatch("retract", occ)}
            >{busy ? "…" : `✕ ${$t("shifts.retract")}`}</button
          >
        {/if}
      </span>
    {:else if occ && signer}
      <!-- Take/Drop rides the capacity row's right edge. A full shift offers
           no Take (capacity is cooperative, and a wall display shouldn't
           invite overbooking); Drop is always offered on a taken shift. -->
      {#if mine}
        <button
          class="rsvp drop"
          disabled={busy}
          on:click={() => occ && dispatch("drop", occ)}
          >{busy ? "…" : `✕ ${$t("shifts.drop")}`}</button
        >
      {:else if capacity === undefined || cov.missing > 0}
        <button
          class="rsvp take"
          disabled={busy}
          on:click={() => occ && dispatch("take", occ)}
          >{busy ? "…" : `✋ ${$t("shifts.take")}`}</button
        >
      {/if}
    {/if}
  </span>
</article>

<style>
  /* The shift note: same post-it family as the task wall, tinted by code. */
  .shift {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    width: clamp(11rem, 22vw, 15rem);
    padding: 0.7rem 0.85rem 0.65rem;
    border-radius: 4px 14px 14px 14px;
    color: var(--ink);
    box-shadow: var(--shadow-soft);
    transform: rotate(var(--tilt, 0deg));
  }
  .shift.running {
    outline: 2px solid var(--teal);
    outline-offset: 1px;
  }
  .shift.mine {
    outline: 2px solid var(--teal);
    outline-offset: 1px;
    box-shadow: var(--shadow-note);
  }
  /* Nobody on it: the gap the wall exists to show. A warm dashed ring and a
     pulse slow enough not to nag, fast enough to catch an eye crossing the
     room. */
  .shift.unstaffed {
    outline: 2.5px dashed var(--warn, #c8542a);
    outline-offset: 2px;
    animation: shift-pulse 2.8s ease-in-out infinite;
  }
  @keyframes shift-pulse {
    0%,
    100% {
      box-shadow: var(--shadow-soft);
    }
    50% {
      box-shadow:
        var(--shadow-soft),
        0 0 0 6px color-mix(in srgb, var(--warn, #c8542a) 22%, transparent);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .shift.unstaffed {
      animation: none;
    }
  }
  /* Planned, not published: a faint outline of the note that will be. */
  .shift.ghost {
    background: transparent !important;
    border: 2px dashed var(--line);
    box-shadow: none;
    opacity: 0.85;
  }
  .shift.stale {
    filter: saturate(0.4);
  }

  .when {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.45rem;
    font-size: 0.82rem;
    font-weight: 800;
    letter-spacing: 0.02em;
  }
  .live,
  .you,
  .flag {
    padding: 0.08rem 0.45rem;
    border-radius: 999px;
    background: var(--teal);
    color: #fff;
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: nowrap;
  }
  .you {
    margin-left: auto;
    text-transform: none;
    letter-spacing: 0;
  }
  .flag {
    margin-left: auto;
  }
  .ghostflag {
    background: var(--muted);
  }
  .staleflag,
  .driftflag {
    background: var(--warn, #c8542a);
  }
  .ttl {
    font-size: 1rem;
    font-weight: 700;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  /* Secondary text on a tinted note: `--ink-soft` flips with the theme, so
     it stays legible on both the pastel (light) and jewel (dark) grounds. */
  .where,
  .who {
    font-size: 0.8rem;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .who.nobody {
    font-style: italic;
  }

  .cap {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin-top: 0.25rem;
  }
  .pips {
    display: flex;
    gap: 0.22rem;
  }
  .pip {
    width: 0.62rem;
    height: 0.62rem;
    border-radius: 50%;
    border: 1.5px solid var(--ink-soft);
    background: transparent;
  }
  .pip.filled {
    background: var(--ink);
    border-color: transparent;
  }
  .cap-label {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--ink-soft);
  }
  .cap-label.needs {
    color: var(--teal-deep);
  }
  .cap-label.loud {
    color: var(--warn, #c8542a);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .cap-label.full {
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  /* The dark skin's accent must be brightened to read on the deep note
     grounds (same trick as app.css's .tool.check). */
  :global([data-theme="dark"]) .cap-label.needs {
    color: color-mix(in srgb, var(--teal) 45%, #fff);
  }
  :global([data-theme="dark"]) .cap-label.loud {
    color: color-mix(in srgb, var(--warn, #c8542a) 55%, #fff);
  }

  /* Take / Drop — a proper touch target riding the capacity row's right
     edge. Take carries the accent (the invitation); Drop stays quiet. */
  .tools {
    margin-left: auto;
    display: flex;
    gap: 0.35rem;
  }
  .rsvp {
    margin-left: auto;
    padding: 0.4rem 0.85rem;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 700;
    white-space: nowrap;
    transition:
      transform 0.1s ease,
      filter 0.15s ease;
  }
  .tools .rsvp {
    margin-left: 0;
  }
  .rsvp:active {
    transform: scale(0.94);
  }
  .rsvp[disabled] {
    opacity: 0.6;
  }
  .rsvp.take {
    background: var(--teal);
    color: #fff;
    box-shadow: var(--shadow-soft);
  }
  .rsvp.drop {
    background: rgba(0, 0, 0, 0.12);
    color: var(--ink);
  }
  :global([data-theme="dark"]) .rsvp.drop {
    background: rgba(0, 0, 0, 0.3);
  }
</style>
