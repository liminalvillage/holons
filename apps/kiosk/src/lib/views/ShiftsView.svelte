<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The Shifts board: the community shift schedule for the next two weeks,
  // read from a Nostr relay in the Elinor format (docs/shifts-elinor.md).
  // Day rows like the Calendar's week layout; each shift is a post-it note
  // (ShiftNote — the same card the configuration preview draws) tinted by
  // its shift code, carrying its time, place, who is on it and — the point
  // of a wall display — how many hands it still needs. A shift with nobody
  // on it is the loud one. A logged-in user can Take and Drop shifts under
  // their OWN pubkey (see `shiftSigner` in $lib/shifts): Telegram logins are
  // signed server-side with the same derived key the bot's /shifts uses,
  // key logins sign right here. The ⚙ opens the coordinator's plan — add,
  // edit, remove shifts and publish or retract occurrences — login-gated
  // like every kiosk write.
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { autoScrollToEnd } from "$lib/autoscroll";
  import {
    rawShifts,
    shiftIdentity,
    shiftNames,
    shiftsLoaded,
    now,
    searchQuery,
    holonId,
  } from "$lib/stores";
  import { showNotice } from "$lib/stores";
  import { currentUser, isLoggedIn, loginOpen } from "$lib/auth";
  import { t, locale } from "$lib/i18n";
  import type { ShiftOccurrence } from "@holons/core/shifts";
  import {
    boardSummary,
    groupShiftsByDay,
    setShiftRsvp,
    shiftCoordinator,
    shiftMatchesQuery,
    shiftSigner,
    upcomingShifts,
  } from "$lib/shifts";
  import ShiftNote from "$lib/components/ShiftNote.svelte";
  import ShiftSettings from "$lib/components/ShiftSettings.svelte";

  $: nowSec = Math.floor($now.getTime() / 1000);
  $: shown = upcomingShifts($rawShifts.occurrences, nowSec).filter((o) =>
    shiftMatchesQuery(o, $searchQuery),
  );
  $: days = groupShiftsByDay(shown);
  $: rsvps = $rawShifts.rsvps;
  // Person-identity collapse (kind 31926): one signup per person, however
  // many keys they hold — a cancel under one key clears the person's spot.
  $: identity = $shiftIdentity;
  // The headline: what the wall is for. Counted over the whole window, not
  // the search-filtered subset, so a search never hides a gap.
  $: summary = boardSummary(
    upcomingShifts($rawShifts.occurrences, nowSec),
    rsvps,
    identity,
  );

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

  // ── The coordinator's ⚙ ──────────────────────────────────────────────---
  // Login-gated like every kiosk write; the sheet itself tells a logged-in
  // user who may not publish (no derivation secret, not a manager) why.
  let settingsOpen = false;
  function openSettings() {
    if (!get(currentUser)) {
      loginOpen.set(true);
      return;
    }
    settingsOpen = true;
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
    <div class="titles">
      <h2>{$t("shifts.heading")}</h2>
      {#if summary.shifts && (summary.unstaffed || summary.spotsOpen)}
        <span class="sub gap">
          {#if summary.unstaffed}
            <span class="alarm"
              >{$t("shifts.unstaffedCount", { n: summary.unstaffed })}</span
            >
            ·
          {/if}
          {$t("shifts.spotsOpenTotal", { n: summary.spotsOpen })}
        </span>
      {:else if summary.shifts}
        <span class="sub">{$t("shifts.allCovered")}</span>
      {:else}
        <span class="sub">{$t("shifts.subtitle")}</span>
      {/if}
    </div>
    <button
      class="gear"
      type="button"
      aria-label={$t("shifts.configure")}
      title={$t("shifts.configure")}
      on:click={openSettings}>⚙</button
    >
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
                <ShiftNote
                  {occ}
                  {rsvps}
                  names={$shiftNames}
                  {identity}
                  {nowSec}
                  signer={$shiftSigner}
                  busy={pending.has(occ.address)}
                  on:take={(e) => toggle(e.detail, false)}
                  on:drop={(e) => toggle(e.detail, true)}
                />
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
      <p class="state">
        {$t("shifts.empty")}
        {#if $shiftCoordinator?.allowed}
          <br /><button class="link" type="button" on:click={openSettings}
            >{$t("shifts.emptyCta")}</button
          >
        {/if}
      </p>
    {/if}
  </div>
</div>

{#if settingsOpen && $holonId}
  <ShiftSettings holonId={$holonId} on:close={() => (settingsOpen = false)} />
{/if}

<style>
  .shifts {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .head {
    flex: 0 0 auto;
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 0.6rem;
    padding: 0.8rem 1.4rem 0.6rem;
  }
  .titles {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    /* Centred under the whole header, the gear notwithstanding. */
    grid-column: 1 / -1;
    grid-row: 1;
  }
  .gear {
    grid-column: 2;
    grid-row: 1;
    justify-self: end;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    font-size: 1.2rem;
    color: var(--ink-soft);
    background: var(--paper);
    box-shadow: var(--shadow-soft);
  }
  .gear:active {
    transform: scale(0.92);
  }
  .sub.gap {
    font-weight: 700;
    color: var(--ink-soft);
  }
  .alarm {
    color: var(--warn);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .link {
    margin-top: 0.6rem;
    padding: 0.5rem 1rem;
    border-radius: 999px;
    background: var(--teal);
    color: #fff;
    font-weight: 700;
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
