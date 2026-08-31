<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The Shifts board: the community shift schedule for the next two weeks,
  // read from a Nostr relay in the Elinor format (docs/shifts-elinor.md).
  // Day rows like the Calendar's week layout; each shift is a post-it note
  // tinted by its shift code, carrying its time, place and — the point of a
  // wall display — how many hands it still needs. A logged-in user can Take
  // and Drop shifts under their OWN pubkey (see `shiftSigner` in
  // $lib/shifts): Telegram logins are signed server-side with the same
  // derived key the bot's /shifts uses, key logins sign right here.
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { autoScrollToEnd } from "$lib/autoscroll";
  import {
    rawShifts,
    shiftNames,
    shiftsLoaded,
    now,
    searchQuery,
  } from "$lib/stores";
  import { showNotice } from "$lib/stores";
  import { isLoggedIn, loginOpen } from "$lib/auth";
  import { t, locale } from "$lib/i18n";
  import {
    enrolledPubkeys,
    formatShiftTime,
    isEnrolled,
  } from "@holons/core/shifts";
  import type { ShiftOccurrence } from "@holons/core/shifts";
  import {
    groupShiftsByDay,
    isRunningNow,
    participantNames,
    setShiftRsvp,
    shiftMatchesQuery,
    shiftSigner,
    spotsLeft,
    upcomingShifts,
  } from "$lib/shifts";
  import { noteColor, noteTilt } from "$lib/data";

  $: nowSec = Math.floor($now.getTime() / 1000);
  $: shown = upcomingShifts($rawShifts.occurrences, nowSec).filter((o) =>
    shiftMatchesQuery(o, $searchQuery),
  );
  $: days = groupShiftsByDay(shown);
  $: rsvps = $rawShifts.rsvps;

  function pad2(n: number): string {
    return String(n).padStart(2, "0");
  }
  $: todayIso = `${$now.getFullYear()}-${pad2($now.getMonth() + 1)}-${pad2($now.getDate())}`;

  /** Relative badge for the day chip ("today"/"tomorrow"), or "". */
  function relDay(iso: string): "dates.today" | "dates.tomorrow" | "" {
    if (iso === todayIso) return "dates.today";
    const [y, m, d] = iso.split("-").map(Number);
    const next = new Date($now.getFullYear(), $now.getMonth(), $now.getDate());
    next.setDate(next.getDate() + 1);
    return y === next.getFullYear() &&
      m === next.getMonth() + 1 &&
      d === next.getDate()
      ? "dates.tomorrow"
      : "";
  }

  function dayDate(iso: string): Date {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  }

  function timeRange(occ: ShiftOccurrence): string {
    return `${formatShiftTime(occ.start, occ.startTzid)} – ${formatShiftTime(occ.end, occ.startTzid)}`;
  }

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

  // ── Take / Drop ───────────────────────────────────────────────────────---
  // One in-flight RSVP per occurrence; the button shows … while it publishes.
  let pending = new Set<string>();

  async function toggle(occ: ShiftOccurrence, enrolled: boolean) {
    if (!get(isLoggedIn)) {
      loginOpen.set(true);
      return;
    }
    if (!$shiftSigner) {
      showNotice($t("shifts.noSigner"));
      return;
    }
    if (pending.has(occ.address)) return;
    pending = new Set(pending).add(occ.address);
    try {
      await setShiftRsvp(occ, enrolled ? "declined" : "accepted");
    } catch (err) {
      showNotice(
        $t("shifts.rsvpFailed", {
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      const next = new Set(pending);
      next.delete(occ.address);
      pending = next;
    }
  }

  let scrollEl: HTMLElement;
  onMount(() => {
    // Unattended kiosks glide the list once so later days below the fold get
    // their moment; any touch cancels it (see autoscroll.ts).
    const stop = scrollEl ? autoScrollToEnd(scrollEl) : () => {};
    return stop;
  });
</script>

<div class="shifts">
  <header class="head">
    <h2>{$t("shifts.heading")}</h2>
    <span class="sub">{$t("shifts.subtitle")}</span>
  </header>

  <div class="scrollarea scroll" bind:this={scrollEl}>
    {#if days.length}
      <div class="board">
        {#each days as day (day.iso)}
          {@const rel = relDay(day.iso)}
          <section class="row" class:today={day.iso === todayIso}>
            <div class="daychip">
              <span class="dow"
                >{dayDate(day.iso).toLocaleDateString($locale, {
                  weekday: "short",
                })}</span
              >
              <span class="dom">{dayDate(day.iso).getDate()}</span>
              <span class="mon"
                >{dayDate(day.iso).toLocaleDateString($locale, {
                  month: "short",
                })}</span
              >
              {#if rel}<span class="rel">{$t(rel)}</span>{/if}
            </div>
            <div class="row-notes">
              {#each day.occurrences as occ (occ.address)}
                {@const taken = enrolledPubkeys(occ, rsvps).length}
                {@const open = spotsLeft(occ, rsvps)}
                {@const running = isRunningNow(occ, nowSec)}
                {@const mine =
                  !!$shiftSigner && isEnrolled(occ, $shiftSigner.pubkey, rsvps)}
                {@const busy = pending.has(occ.address)}
                <article
                  class="shift tilt"
                  class:running
                  class:mine
                  class:needy={open !== null && open > 0 && !running}
                  style="--tilt: {noteTilt(
                    occ.address,
                  )}deg; background: {noteColor(occ.code)};"
                  title={occ.content || occ.title}
                >
                  <span class="when"
                    >{timeRange(occ)}{#if running}<span class="live"
                        >{$t("shifts.now")}</span
                      >{/if}{#if mine}<span class="you"
                        >✓ {$t("shifts.youAreOn")}</span
                      >{/if}</span
                  >
                  <span class="ttl">{occ.title}</span>
                  {#if occ.location}<span class="where">⌖ {occ.location}</span
                    >{/if}
                  {#if taken > 0}
                    {@const who = participantNames(occ, rsvps, $shiftNames)}
                    <span class="who"
                      >{who.shown.join(", ")}{#if who.more > 0}
                        {$t("shifts.more", { n: who.more })}{/if}</span
                    >
                  {/if}
                  <span class="cap">
                    {#if dots(taken, occ.capacity).length}
                      <span class="pips" aria-hidden="true">
                        {#each dots(taken, occ.capacity) as filled, i (i)}
                          <span class="pip" class:filled></span>
                        {/each}
                      </span>
                    {/if}
                    {#if open === null}
                      <span class="cap-label"
                        >{$t("shifts.signedUp", { n: taken })}</span
                      >
                    {:else if open === 0}
                      <span class="cap-label full">{$t("shifts.full")}</span>
                    {:else}
                      <span class="cap-label needs"
                        >{$t("shifts.spotsOpen", { n: open })}</span
                      >
                    {/if}
                    <!-- Take/Drop rides the capacity row's right edge. A full
                         shift offers no Take (capacity is cooperative, and a
                         wall display shouldn't invite overbooking); Drop is
                         always offered on a taken shift. -->
                    {#if mine}
                      <button
                        class="rsvp drop"
                        disabled={busy}
                        on:click={() => toggle(occ, true)}
                        >{busy ? "…" : `✕ ${$t("shifts.drop")}`}</button
                      >
                    {:else if open !== 0}
                      <button
                        class="rsvp take"
                        disabled={busy}
                        on:click={() => toggle(occ, false)}
                        >{busy ? "…" : `✋ ${$t("shifts.take")}`}</button
                      >
                    {/if}
                  </span>
                </article>
              {/each}
            </div>
          </section>
        {/each}
      </div>
      {#if !$shiftSigner}
        <p class="foot">{$t("shifts.signupHint")}</p>
      {/if}
    {:else if !$shiftsLoaded}
      <p class="state">{$t("shifts.loading")}</p>
    {:else if $searchQuery.trim()}
      <p class="state">{$t("shifts.noMatch")}</p>
    {:else}
      <p class="state">{$t("shifts.empty")}</p>
    {/if}
  </div>
</div>

<style>
  .shifts {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .head {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    padding: 0.8rem 1.4rem 0.6rem;
  }
  .head h2 {
    margin: 0;
    font-size: 1.45rem;
    font-weight: 700;
    color: var(--ink);
    letter-spacing: 0.01em;
  }
  .sub {
    font-size: 0.85rem;
    color: var(--muted);
  }

  .scrollarea {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0.2rem 1.4rem 1.2rem;
  }

  .board {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  /* One day per row, like the Calendar's week layout. */
  .row {
    display: flex;
    align-items: flex-start;
    gap: 0.9rem;
    padding: 0.55rem 0.4rem;
    border-radius: 14px;
  }
  .row.today {
    background: var(--paper);
  }

  .daychip {
    flex: 0 0 4.2rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.05rem;
    padding-top: 0.3rem;
  }
  .dow {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .dom {
    font-size: 1.5rem;
    font-weight: 800;
    line-height: 1.1;
    color: var(--ink);
  }
  .mon {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .rel {
    margin-top: 0.25rem;
    padding: 0.12rem 0.5rem;
    border-radius: 999px;
    background: var(--teal);
    color: #fff;
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: capitalize;
    white-space: nowrap;
  }

  .row-notes {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.85rem;
  }

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

  .when {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.82rem;
    font-weight: 800;
    letter-spacing: 0.02em;
  }
  .live {
    padding: 0.08rem 0.45rem;
    border-radius: 999px;
    background: var(--teal);
    color: #fff;
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .you {
    margin-left: auto;
    padding: 0.08rem 0.45rem;
    border-radius: 999px;
    background: var(--teal);
    color: #fff;
    font-size: 0.65rem;
    font-weight: 700;
    white-space: nowrap;
  }
  .ttl {
    font-size: 1rem;
    font-weight: 700;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  /* Secondary text on a tinted note: `--ink-soft` flips with the theme, so
     it stays legible on both the pastel (light) and jewel (dark) grounds. */
  .where {
    font-size: 0.8rem;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Who is on the shift — names from the identity attestations, hex
     prefixes for keys nobody has attested yet. */
  .who {
    font-size: 0.8rem;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cap {
    display: flex;
    align-items: center;
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
  /* The dark skin's accent must be brightened to read on the deep note
     grounds (same trick as app.css's .tool.check). */
  :global([data-theme="dark"]) .cap-label.needs {
    color: color-mix(in srgb, var(--teal) 45%, #fff);
  }

  /* Take / Drop — a proper touch target riding the capacity row's right
     edge. Take carries the accent (the invitation); Drop stays quiet. */
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
  /* When "you" rides the when-row, the Drop button doesn't need to fight it
     for the right edge — keep the cap row tidy. */
  .cap {
    flex-wrap: wrap;
  }
  .cap-label.full {
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .foot {
    margin: 1.1rem 0 0;
    text-align: center;
    font-size: 0.8rem;
    color: var(--muted);
  }

  .state {
    margin: 3rem 1rem;
    text-align: center;
    color: var(--muted);
    font-size: 1rem;
  }
</style>
