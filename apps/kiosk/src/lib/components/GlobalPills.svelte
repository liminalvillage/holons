<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The single pills band for the whole kiosk: one Show pill (scope) plus the
  // active tab's own Layout/Sort segments. Rendered once by the page shell —
  // outside the tab-keyed view mount, so switching tabs swaps the segments
  // without replaying the entrance animation — and collapsed together with
  // the header chrome when the screen goes idle (same recipe as TabBar).
  //
  // Layout adapts to the width available, one pill at a time: every pill
  // starts unpacked — full segments, each carrying its option name — and as
  // the row runs out of room they collapse into the small cycling toggle
  // RIGHT to LEFT (Sort first, the Show pill last), so the leftmost pills
  // keep their names as long as they fit. The row stays in the same spread
  // arrangement throughout — Show pinned left, the tab's pills pinned
  // right — so nothing jumps sideways as tabs switch. Only when even the
  // all-compact row can't fit does the band fall back to the full segmented
  // pills, centred and wrapping. One hidden copy of the row per packing
  // level is measured against the band to decide.
  import {
    activeTab,
    idle,
    pillsSuppressed,
    taskViewMode,
    taskSort,
    libraryViewMode,
    libraryCalendarMode,
    rolesViewMode,
    calendarMode,
  } from "$lib/stores";
  import {
    setTaskView,
    setTaskSort,
    setLibraryView,
    setRolesView,
    setCalendarView,
    setLibraryCalendarView,
    type TaskViewMode,
    type LibraryViewMode,
    type RolesViewMode,
    type CalendarMode,
  } from "$lib/config";
  import type { TaskSort } from "$lib/data";
  import { LAYOUT_SEGMENTS, SORT_SEGMENTS } from "$lib/pills";
  import { t, type MessageKey, type Translator } from "$lib/i18n";
  import PillSwitch from "./PillSwitch.svelte";
  import ScopePill from "./ScopePill.svelte";

  // Module consts carry catalog keys only; `ownPillsFor` resolves them with
  // the reactive translator so a language switch re-labels every pill live.

  // ── Tasks: swipe deck / compact list / post-it wall. Whose tasks show is
  // the orthogonal Show pill (scope) — see ScopePill.
  const TASK_MODES: {
    id: TaskViewMode;
    glyph: string;
    labelKey: MessageKey;
  }[] = [
    { id: "swipe", ...LAYOUT_SEGMENTS.card },
    { id: "list", ...LAYOUT_SEGMENTS.list },
    { id: "cards", ...LAYOUT_SEGMENTS.wall },
    { id: "graph", ...LAYOUT_SEGMENTS.graph },
  ];

  // ── Library: one card at a time / compact list / icon card grid (wall) /
  // the booking calendar (when each thing is out).
  const LIBRARY_MODES: {
    id: LibraryViewMode;
    glyph: string;
    labelKey: MessageKey;
  }[] = [
    { id: "swipe", ...LAYOUT_SEGMENTS.card },
    { id: "list", ...LAYOUT_SEGMENTS.list },
    { id: "cards", ...LAYOUT_SEGMENTS.wall },
    { id: "calendar", ...LAYOUT_SEGMENTS.calendar },
  ];

  // ── Roles: compact rows / today cards (wall) / week grid.
  const ROLES_MODES: {
    id: RolesViewMode;
    glyph: string;
    labelKey: MessageKey;
  }[] = [
    { id: "list", ...LAYOUT_SEGMENTS.list },
    { id: "cards", ...LAYOUT_SEGMENTS.wall },
    { id: "week", ...LAYOUT_SEGMENTS.week },
  ];

  // ── Calendar: day / week / month window. Glyphs keep the compact cycling
  // toggle legible once names drop.
  const CAL_MODES: { id: CalendarMode; glyph: string; labelKey: MessageKey }[] =
    [
      { id: "day", glyph: "▣", labelKey: "pills.day" },
      { id: "week", glyph: "▤", labelKey: "pills.week" },
      { id: "month", glyph: "▦", labelKey: "pills.month" },
      { id: "year", glyph: "☾", labelKey: "pills.year" },
    ];

  /** Resolve a keyed segment list into PillSwitch options. */
  function resolve(
    tr: Translator,
    segs: readonly { id: string; glyph: string; labelKey: MessageKey }[],
  ) {
    return segs.map(({ id, glyph, labelKey }) => ({
      id,
      glyph,
      label: tr(labelKey),
    }));
  }

  function pickTaskMode(m: string) {
    taskViewMode.set(m as TaskViewMode);
    setTaskView(m as TaskViewMode);
  }
  function pickTaskSort(s: string) {
    taskSort.set(s as TaskSort);
    setTaskSort(s as TaskSort);
  }
  function pickLibraryMode(m: string) {
    libraryViewMode.set(m as LibraryViewMode);
    setLibraryView(m as LibraryViewMode);
  }
  function pickRolesMode(m: string) {
    rolesViewMode.set(m as RolesViewMode);
    setRolesView(m as RolesViewMode);
  }
  // Only the choice itself lives here; CalendarView reacts to the store for
  // its offset-reset / focus side effects.
  function pickCalendarMode(m: string) {
    calendarMode.set(m as CalendarMode);
    setCalendarView(m as CalendarMode);
  }
  // The Library's booking calendar keeps its own window (month by default),
  // so switching it never disturbs the Calendar tab.
  function pickLibraryCalendarMode(m: string) {
    libraryCalendarMode.set(m as CalendarMode);
    setLibraryCalendarView(m as CalendarMode);
  }

  // The active tab's own pills, as data, so the visible row and the hidden
  // measuring row render from the same list.
  interface OwnPill {
    key: string;
    options: { id: string; label: string; glyph?: string }[];
    value: string;
    onChange: (id: string) => void;
    icon: "eye" | "sort";
    title: string;
    label: string;
    showText?: boolean;
  }
  function ownPillsFor(
    tr: Translator,
    tab: string,
    taskMode: string,
    sort: string,
    libMode: string,
    libCalMode: string,
    rolesMode: string,
    calMode: string,
  ): OwnPill[] {
    if (tab === "tasks")
      return [
        {
          key: "layout",
          options: resolve(tr, TASK_MODES),
          value: taskMode,
          onChange: pickTaskMode,
          icon: "eye",
          title: tr("pills.view"),
          label: tr("pills.tasksLayout"),
        },
        {
          key: "sort",
          options: resolve(tr, SORT_SEGMENTS),
          value: sort,
          onChange: pickTaskSort,
          icon: "sort",
          title: tr("pills.sort"),
          label: tr("pills.tasksOrder"),
        },
      ];
    if (tab === "library")
      return [
        {
          key: "layout",
          options: resolve(tr, LIBRARY_MODES),
          value: libMode,
          onChange: pickLibraryMode,
          icon: "eye",
          title: tr("pills.view"),
          label: tr("pills.libraryLayout"),
        },
        // On the booking calendar the day/week/month pill comes along — it is
        // the same CalendarView, over its own (library) window.
        ...(libMode === "calendar"
          ? [
              {
                key: "window",
                options: resolve(tr, CAL_MODES),
                value: libCalMode,
                onChange: pickLibraryCalendarMode,
                icon: "eye" as const,
                title: tr("pills.view"),
                label: tr("pills.calendarView"),
              },
            ]
          : []),
      ];
    if (tab === "roles")
      return [
        {
          key: "layout",
          options: resolve(tr, ROLES_MODES),
          value: rolesMode,
          onChange: pickRolesMode,
          icon: "eye",
          title: tr("pills.view"),
          label: tr("pills.rolesLayout"),
        },
      ];
    if (tab === "calendar")
      return [
        {
          key: "layout",
          options: resolve(tr, CAL_MODES),
          value: calMode,
          onChange: pickCalendarMode,
          icon: "eye",
          title: tr("pills.view"),
          label: tr("pills.calendarView"),
          showText: true,
        },
      ];
    return []; // checklists: the Show pill alone
  }
  $: ownPills = ownPillsFor(
    $t,
    $activeTab,
    $taskViewMode,
    $taskSort,
    $libraryViewMode,
    $libraryCalendarMode,
    $rolesViewMode,
    $calendarMode,
  );

  // How many pills, counting from the RIGHT, collapse into the cycling
  // toggle. Level 0 is everything unpacked, level `total` everything
  // compact; the first level whose hidden copy fits the band wins, so pills
  // give up their names right-to-left and the Show pill packs last. -1
  // means even all-compact overflows → the wrapped fallback. Before the
  // widths are known, assume all-compact (the common case — no flash of a
  // row that's about to collapse).
  let bandWidth = 0;
  let levelWidths: number[] = [];
  $: total = ownPills.length + 1; // the tab's own pills + the Show pill
  $: levels = Array.from({ length: total + 1 }, (_, k) => k);
  $: packCount = pickLevel(bandWidth, levelWidths, total);
  function pickLevel(band: number, widths: number[], all: number): number {
    if (!band || !widths[all]) return all;
    for (let k = 0; k <= all; k++)
      if ((widths[k] || Infinity) <= band) return k;
    return -1;
  }
  $: oneRow = packCount >= 0;
  // Which pill packs at the current level: the combined row is
  // [Show, ...ownPills], so own pill i packs once i >= ownPills.length - k,
  // and Show (leftmost) only at k === total.
  const ownPacked = (i: number, k: number, count: number) => i >= count - k;

  $: hidden = $idle || $pillsSuppressed;
</script>

<!-- Status deliberately has no pills: the leaderboard is holon-only. Shifts
     has none either: the relay schedule knows nothing of scopes or layouts. -->
{#if $activeTab !== "status" && $activeTab !== "shifts"}
  <div
    class="gpills"
    class:hidden
    aria-hidden={hidden}
    bind:clientWidth={bandWidth}
  >
    {#if oneRow}
      <div class="row spread">
        <ScopePill compact={packCount >= total} expanded={packCount < total} />
        <div class="own">
          {#each ownPills as p, i (p.key)}
            {@const packed = ownPacked(i, packCount, ownPills.length)}
            <PillSwitch
              compact={packed}
              expanded={!packed}
              options={p.options}
              value={p.value}
              onChange={p.onChange}
              icon={p.icon}
              title={p.title}
              label={p.label}
              showText={packed ? (p.showText ?? false) : true}
            />
          {/each}
        </div>
      </div>
    {:else}
      <div class="row centered">
        <ScopePill />
        {#each ownPills as p (p.key)}
          <PillSwitch
            options={p.options}
            value={p.value}
            onChange={p.onChange}
            icon={p.icon}
            title={p.title}
            label={p.label}
            showText={p.showText ?? false}
          />
        {/each}
      </div>
    {/if}

    <!-- Invisible copies, one per packing level (level k = the k rightmost
         pills compact), measured to pick the level above. -->
    {#each levels as k (k)}
      <div
        class="measure"
        aria-hidden="true"
        inert
        bind:clientWidth={levelWidths[k]}
      >
        <ScopePill compact={k >= total} expanded={k < total} />
        {#each ownPills as p, i (p.key)}
          {@const packed = ownPacked(i, k, ownPills.length)}
          <PillSwitch
            compact={packed}
            expanded={!packed}
            options={p.options}
            value={p.value}
            onChange={p.onChange}
            icon={p.icon}
            title={p.title}
            label={p.label}
            showText={packed ? (p.showText ?? false) : true}
          />
        {/each}
      </div>
    {/each}
  </div>
{/if}

<style>
  /* Collapse with the header chrome: zero height when hidden so the view
     below reclaims the band (mirrors TabBar's .bar.idle recipe). The inner
     row owns the padding; overflow clips it during the transition. */
  .gpills {
    position: relative;
    flex: 0 0 auto;
    max-height: 12rem; /* headroom for the wrapped centred fallback */
    overflow: hidden;
    transition:
      opacity 0.5s ease,
      max-height 0.5s ease;
  }
  .gpills.hidden {
    opacity: 0;
    max-height: 0;
    pointer-events: none;
  }
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.6rem;
    padding: 0.9rem 1.4rem 0.2rem;
  }
  /* One compact row: Show pinned left, the tab's own pills pinned right, so
     neither jumps sideways as tab switches change how many segments render. */
  .row.spread {
    justify-content: space-between;
  }
  .own {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-left: auto;
  }
  /* Fallback when even the toggles outgrow one row: full pills, centred,
     wrapping to as many rows as they need. */
  .row.centered {
    justify-content: center;
  }
  /* The measuring copy: laid out at natural single-row width (same gap and
     side padding as the real row — clientWidth includes the padding), but
     invisible and inert. */
  .measure {
    position: absolute;
    visibility: hidden;
    pointer-events: none;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0 1.4rem;
    width: max-content;
  }
  @media (max-width: 560px) {
    .row {
      gap: 0.4rem;
      padding: 0.5rem 0.7rem 0.1rem;
    }
    .own {
      gap: 0.4rem;
    }
    .measure {
      gap: 0.4rem;
      padding: 0 0.7rem;
    }
  }
</style>
