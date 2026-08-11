<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The single pills band for the whole kiosk: one Show pill (scope) plus the
  // active tab's own Layout/Sort segments. Rendered once by the page shell —
  // outside the tab-keyed view mount, so switching tabs swaps the segments
  // without replaying the entrance animation — and collapsed together with
  // the header chrome when the screen goes idle (same recipe as TabBar).
  //
  // Layout adapts to the width available, widest first: when the fully
  // unpacked pills — every segment carrying its option name — fit on ONE
  // row, they're used, Show pinned left and the tab's pills pinned right.
  // When they don't, the small cycling toggles take the row in the same
  // spread arrangement, so nothing jumps sideways as tabs switch. Only when
  // even the toggles can't share a row does the band fall back to the full
  // segmented pills, centred and wrapping. Two hidden copies of the row —
  // one unpacked, one always-compact — are measured against the band to
  // decide.
  import {
    activeTab,
    idle,
    pillsSuppressed,
    taskViewMode,
    taskSort,
    libraryViewMode,
    rolesViewMode,
    calendarMode,
  } from "$lib/stores";
  import {
    setTaskView,
    setTaskSort,
    setLibraryView,
    setRolesView,
    setCalendarView,
    type TaskViewMode,
    type LibraryViewMode,
    type RolesViewMode,
    type CalendarMode,
  } from "$lib/config";
  import type { TaskSort } from "$lib/data";
  import { LAYOUT_SEGMENTS, SORT_SEGMENTS } from "$lib/pills";
  import PillSwitch from "./PillSwitch.svelte";
  import ScopePill from "./ScopePill.svelte";

  // ── Tasks: swipe deck / compact list / post-it wall. Whose tasks show is
  // the orthogonal Show pill (scope) — see ScopePill.
  const TASK_MODES: { id: TaskViewMode; glyph: string; label: string }[] = [
    { id: "swipe", ...LAYOUT_SEGMENTS.card },
    { id: "list", ...LAYOUT_SEGMENTS.list },
    { id: "cards", ...LAYOUT_SEGMENTS.wall },
  ];

  // ── Library: one card at a time / compact list / icon card grid (wall).
  const LIBRARY_MODES: { id: LibraryViewMode; glyph: string; label: string }[] =
    [
      { id: "swipe", ...LAYOUT_SEGMENTS.card },
      { id: "list", ...LAYOUT_SEGMENTS.list },
      { id: "cards", ...LAYOUT_SEGMENTS.wall },
    ];

  // ── Roles: compact rows / today cards (wall) / week grid.
  const ROLES_MODES: { id: RolesViewMode; glyph: string; label: string }[] = [
    { id: "list", ...LAYOUT_SEGMENTS.list },
    { id: "cards", ...LAYOUT_SEGMENTS.wall },
    { id: "week", ...LAYOUT_SEGMENTS.week },
  ];

  // ── Calendar: day / week / month window. Glyphs keep the compact cycling
  // toggle legible once names drop.
  const CAL_GLYPHS: Record<CalendarMode, string> = {
    day: "▣",
    week: "▤",
    month: "▦",
  };
  const CAL_MODES = (["day", "week", "month"] as CalendarMode[]).map((m) => ({
    id: m,
    label: m.charAt(0).toUpperCase() + m.slice(1),
    glyph: CAL_GLYPHS[m],
  }));

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
    tab: string,
    taskMode: string,
    sort: string,
    libMode: string,
    rolesMode: string,
    calMode: string,
  ): OwnPill[] {
    if (tab === "tasks")
      return [
        {
          key: "layout",
          options: TASK_MODES,
          value: taskMode,
          onChange: pickTaskMode,
          icon: "eye",
          title: "View",
          label: "Tasks layout",
        },
        {
          key: "sort",
          options: [...SORT_SEGMENTS],
          value: sort,
          onChange: pickTaskSort,
          icon: "sort",
          title: "Sort",
          label: "Tasks order",
        },
      ];
    if (tab === "library")
      return [
        {
          key: "layout",
          options: LIBRARY_MODES,
          value: libMode,
          onChange: pickLibraryMode,
          icon: "eye",
          title: "View",
          label: "Library layout",
        },
      ];
    if (tab === "roles")
      return [
        {
          key: "layout",
          options: ROLES_MODES,
          value: rolesMode,
          onChange: pickRolesMode,
          icon: "eye",
          title: "View",
          label: "Roles layout",
        },
      ];
    if (tab === "calendar")
      return [
        {
          key: "layout",
          options: CAL_MODES,
          value: calMode,
          onChange: pickCalendarMode,
          icon: "eye",
          title: "View",
          label: "Calendar view",
          showText: true,
        },
      ];
    return []; // checklists: the Show pill alone
  }
  $: ownPills = ownPillsFor(
    $activeTab,
    $taskViewMode,
    $taskSort,
    $libraryViewMode,
    $rolesViewMode,
    $calendarMode,
  );

  // Width tiers, each a one-row test against a hidden copy: unpacked pills
  // (names on every segment) win when they fit; the compact toggles are the
  // middle tier. Before the widths are known, assume compact fits and
  // unpacked doesn't (compact is the common case — no flash of a row that's
  // about to collapse).
  let bandWidth = 0;
  let compactWidth = 0;
  let unpackedWidth = 0;
  $: unpacked = !!bandWidth && !!unpackedWidth && unpackedWidth <= bandWidth;
  $: oneRow = !bandWidth || !compactWidth || compactWidth <= bandWidth;

  $: hidden = $idle || $pillsSuppressed;
</script>

<!-- Status deliberately has no pills: the leaderboard is holon-only. -->
{#if $activeTab !== "status"}
  <div
    class="gpills"
    class:hidden
    aria-hidden={hidden}
    bind:clientWidth={bandWidth}
  >
    {#if unpacked}
      <div class="row spread">
        <ScopePill expanded />
        <div class="own">
          {#each ownPills as p (p.key)}
            <PillSwitch
              expanded
              showText
              options={p.options}
              value={p.value}
              onChange={p.onChange}
              icon={p.icon}
              title={p.title}
              label={p.label}
            />
          {/each}
        </div>
      </div>
    {:else if oneRow}
      <div class="row spread">
        <ScopePill compact />
        <div class="own">
          {#each ownPills as p (p.key)}
            <PillSwitch
              compact
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

    <!-- Invisible copies, measured to pick the layout above: one fully
         unpacked (names on every segment), one always-compact. -->
    <div
      class="measure"
      aria-hidden="true"
      inert
      bind:clientWidth={unpackedWidth}
    >
      <ScopePill expanded />
      {#each ownPills as p (p.key)}
        <PillSwitch
          expanded
          showText
          options={p.options}
          value={p.value}
          onChange={p.onChange}
          icon={p.icon}
          title={p.title}
          label={p.label}
        />
      {/each}
    </div>
    <div
      class="measure"
      aria-hidden="true"
      inert
      bind:clientWidth={compactWidth}
    >
      <ScopePill compact />
      {#each ownPills as p (p.key)}
        <PillSwitch
          compact
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
