<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import {
    visibleTabs,
    activeTab,
    selectTab,
    togglePin,
    pinnedTab,
    holonName,
    brandName,
    brandLogo,
    userMenuOpen,
    searchQuery,
    searchSuggestions,
    categoryColors,
    now,
    rotating,
    autoRotates,
    idle,
    flipProgress,
    reorderTabs,
    hiddenTabs,
    setTabShown,
  } from "$lib/stores";
  import type { TabId } from "$lib/stores";
  import { moveId } from "$lib/taborder";
  import { currentUser, displayName } from "$lib/auth";
  import { requestClose } from "$lib/dock";
  import { t, locale } from "$lib/i18n";
  import { onMount, tick } from "svelte";
  import { flip } from "svelte/animate";
  import StatusConfirm from "./StatusConfirm.svelte";

  // ── Hold to edit, drag to reorder, ✕ to remove, + to add ──────────────────
  // One press on a tab can mean three things: a tap opens the view; a hold
  // (~half a second, still) lifts the tab and puts the strip in edit mode —
  // every tab grows a ✕ that hides it (the Settings switch for that tab
  // flips with it, both write `setTabShown`); a drag — straight away with a
  // mouse, after the hold on touch, so a quick swipe still scrolls the strip
  // — carries the tab to a new slot, and that order persists
  // (`reorderTabs`). Edit mode ends on a tap anywhere else or when the kiosk
  // goes idle. A hold or a drag swallows the click that follows, so no
  // gesture both rearranges and navigates. Pinning lives on the active
  // tab's pin button.
  const LONG_PRESS_MS = 480;
  const DRAG_SLOP = 6;
  const FLIP_MS = 180;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressId: TabId | null = null;
  let pressX = 0;
  let armed = false; // the tab is lifted: a move now reorders
  let held = false; // the hold fired (a release in place pins)
  let dragId: TabId | null = null;
  let swallowClick = false;
  let lastSwap: { id: string; t: number } | null = null;
  let nav: HTMLElement;
  let strip: HTMLElement;
  let editing = false;
  // The "+" at the strip's end lists the tabs not on it; picking one shows
  // it. Status passes through its framing modal first, like in Settings.
  let addOpen = false;
  let statusConfirmOpen = false;

  function haptic() {
    try {
      navigator.vibrate?.(15);
    } catch {
      /* haptics are best-effort */
    }
  }

  function onTabDown(e: PointerEvent, id: TabId) {
    if (e.button != null && e.button !== 0) return;
    cancelPress();
    swallowClick = false;
    pressId = id;
    pressX = e.clientX;
    held = false;
    armed = e.pointerType === "mouse";
    pressTimer = setTimeout(() => {
      held = true;
      armed = true;
      dragId = id; // lifted, so the hold reads as a grab
      editing = true;
      addOpen = false;
      haptic();
    }, LONG_PRESS_MS);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
  }

  // Pointer events can't stop the strip's own horizontal pan once the browser
  // has the gesture — it fires pointercancel and the drag dies. A non-passive
  // touchmove listener can: swallowing moves once the hold armed the tab keeps
  // the browser from ever starting the scroll.
  function onTouchMove(e: TouchEvent) {
    if (armed) e.preventDefault();
  }

  function cancelPress() {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
    pressId = null;
    armed = false;
    held = false;
    dragId = null;
    lastSwap = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    window.removeEventListener("touchmove", onTouchMove);
  }

  function onMove(e: PointerEvent) {
    if (!pressId) return;
    if (!dragId) {
      if (!armed) return; // touch, before the hold: the strip scrolls
      if (Math.abs(e.clientX - pressX) < DRAG_SLOP) return;
      if (pressTimer) clearTimeout(pressTimer);
      pressTimer = null;
      dragId = pressId;
    } else if (!held && Math.abs(e.clientX - pressX) < DRAG_SLOP) {
      return;
    }
    if (held && Math.abs(e.clientX - pressX) >= DRAG_SLOP) held = false;
    // Where the pointer sits among the OTHER tabs decides the slot. A tab
    // that just moved is still gliding (flip), so its box is ignored briefly
    // — otherwise it swaps back and forth under a still pointer.
    const order = $visibleTabs.map((t) => t.id);
    const els = Array.from(
      nav.querySelectorAll<HTMLElement>("[data-tab]"),
    ).filter((el) => el.dataset.tab !== dragId);
    let index = els.length;
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) {
        index = i;
        break;
      }
    }
    const next = moveId(order, dragId, index);
    const from = order.indexOf(dragId);
    if (next.indexOf(dragId) === from) return;
    const neighbour = els[Math.min(index, els.length - 1)]?.dataset.tab ?? "";
    if (lastSwap?.id === neighbour && performance.now() - lastSwap.t < FLIP_MS)
      return;
    lastSwap = { id: neighbour, t: performance.now() };
    reorderTabs(next as TabId[]);
    // Dragging against an edge of an overflowing strip nudges it along.
    const edge = 40;
    const box = nav.getBoundingClientRect();
    if (e.clientX < box.left + edge) nav.scrollLeft -= 12;
    else if (e.clientX > box.right - edge) nav.scrollLeft += 12;
  }

  function onUp() {
    const dragged = dragId != null && !held;
    // The click that closes out a hold or drag must not navigate. It arrives
    // right after this event (if at all — a moved touch fires none), so the
    // flag lasts one turn and never eats the next honest tap.
    swallowClick = held || dragged;
    if (swallowClick) setTimeout(() => (swallowClick = false), 0);
    cancelPress();
  }

  function onTabClick(id: TabId) {
    if (swallowClick) {
      swallowClick = false; // this click closes out a hold or drag; don't navigate
      return;
    }
    selectTab(id);
    editing = false;
  }

  function removeTab(id: TabId) {
    if ($visibleTabs.length <= 1) return; // the strip never empties
    setTabShown(id, false);
  }

  function addTab(id: TabId) {
    addOpen = false;
    if (id === "status") {
      statusConfirmOpen = true;
      return;
    }
    setTabShown(id, true);
  }

  // A press anywhere off the strip leaves edit mode and closes the "+" menu.
  function onWindowDown(e: PointerEvent) {
    if (!editing && !addOpen) return;
    if (strip?.contains(e.target as Node)) return;
    editing = false;
    addOpen = false;
  }
  $: if ($idle) {
    editing = false;
    addOpen = false;
  }

  // ── Fit: names when they fit, glyphs alone when they don't, then scroll ──
  // The strip measures itself with the labels on; if that overflows the width
  // the tabs drop to icons (the phone layout), and if even the icons overflow
  // the strip scrolls sideways. Re-measured when the tabs, the language, or
  // the width change.
  let compact = false;
  let fitWidth = 0;
  async function fit() {
    if (!nav) return;
    compact = false;
    await tick();
    if (!nav) return;
    compact = nav.scrollWidth > nav.clientWidth + 1;
    fitWidth = nav.clientWidth;
  }
  $: ($visibleTabs, $locale, void fit());
  onMount(() => {
    const ro = new ResizeObserver(() => {
      if (nav && nav.clientWidth !== fitWidth) void fit();
    });
    ro.observe(nav);
    return () => ro.disconnect();
  });

  // The active tab always stays in view on an overflowing strip.
  async function reveal(id: TabId) {
    await tick();
    const el = nav?.querySelector<HTMLElement>(`[data-tab="${id}"]`);
    if (!el || !nav) return;
    const box = nav.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const left = r.left - box.left + nav.scrollLeft;
    const right = left + r.width;
    if (left < nav.scrollLeft) nav.scrollTo({ left, behavior: "smooth" });
    else if (right > nav.scrollLeft + nav.clientWidth)
      nav.scrollTo({ left: right - nav.clientWidth, behavior: "smooth" });
  }
  $: if (nav && !dragId) void reveal($activeTab);

  // Search suggestions: focusing the field opens a dropdown of tappable
  // category and people chips. Chip taps preventDefault on pointerdown so the
  // input never blurs (blur is what closes the panel — tapping anywhere else
  // dismisses it). A chip that already IS the query clears it (toggle).
  let searchFocused = false;
  let searchInput: HTMLInputElement;
  $: suggestOpen =
    searchFocused &&
    ($searchSuggestions.categories.length > 0 ||
      $searchSuggestions.people.length > 0);
  // When the kiosk goes idle the chrome hides — release focus so the panel
  // doesn't linger and the field re-opens cleanly on the next tap.
  $: if ($idle && searchInput) searchInput.blur();

  function applySuggestion(term: string) {
    searchQuery.set(
      $searchQuery.trim().toLowerCase() === term.toLowerCase() ? "" : term,
    );
  }

  $: timeLabel = $now.toLocaleTimeString($locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  $: dateLabel = $now.toLocaleDateString($locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // Caretaker-set name wins over the holon's own name; logo over the default.
  $: brandText = $brandName || $holonName;

  // If the active tab is hidden (e.g. the library just emptied), fall back to
  // the first visible tab without counting it as a user interaction.
  $: if (
    $visibleTabs.length &&
    !$visibleTabs.some((t) => t.id === $activeTab)
  ) {
    activeTab.set($visibleTabs[0].id);
  }
</script>

<!-- The whole header retreats when no one's touching the screen, so the board
     stands alone; any interaction (handled at the window level) brings it back.
     `aria-hidden` while idle keeps it out of the accessibility tree too. -->
<header
  class="bar"
  class:idle={$idle}
  class:suggest-open={suggestOpen || addOpen}
  aria-hidden={$idle}
>
  <div class="top">
    <div class="brand">
      {#if $brandLogo}
        <img class="logo" src={$brandLogo} alt={brandText || "Kiosk"} />
      {:else}
        <span class="wordmark">{brandText || "kiosk"}</span>
      {/if}
    </div>

    <div class="search">
      <svg
        class="search__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" stroke-width="2" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" stroke-width="2" />
      </svg>
      <input
        type="search"
        class="search__input"
        placeholder={$t("tabbar.search")}
        aria-label={$t("tabbar.searchAria")}
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        bind:value={$searchQuery}
        bind:this={searchInput}
        on:focus={() => (searchFocused = true)}
        on:blur={() => (searchFocused = false)}
      />
      {#if $searchQuery}
        <button
          type="button"
          class="search__clear"
          on:click={() => searchQuery.set("")}
          aria-label={$t("tabbar.clearSearch")}>&times;</button
        >
      {/if}

      {#if suggestOpen}
        <div
          class="suggest"
          role="listbox"
          aria-label={$t("tabbar.suggestions")}
        >
          {#if $searchSuggestions.categories.length}
            <div class="suggest__group">{$t("tabbar.categories")}</div>
            <div class="suggest__chips">
              {#each $searchSuggestions.categories as cat (cat)}
                <button
                  type="button"
                  class="chip"
                  role="option"
                  aria-selected={$searchQuery.trim().toLowerCase() ===
                    cat.toLowerCase()}
                  class:on={$searchQuery.trim().toLowerCase() ===
                    cat.toLowerCase()}
                  style="--dot: {$categoryColors.get(cat) ?? 'var(--line)'}"
                  on:pointerdown|preventDefault
                  on:click={() => applySuggestion(cat)}
                >
                  <span class="chip__dot"></span>{cat}
                </button>
              {/each}
            </div>
          {/if}
          {#if $searchSuggestions.people.length}
            <div class="suggest__group">{$t("tabbar.people")}</div>
            <div class="suggest__chips">
              {#each $searchSuggestions.people as person (person)}
                <button
                  type="button"
                  class="chip"
                  role="option"
                  aria-selected={$searchQuery.trim().toLowerCase() ===
                    person.toLowerCase()}
                  class:on={$searchQuery.trim().toLowerCase() ===
                    person.toLowerCase()}
                  on:pointerdown|preventDefault
                  on:click={() => applySuggestion(person)}
                >
                  <span class="chip__face"
                    >{person.replace(/^@/, "")[0]?.toUpperCase() ?? "·"}</span
                  >{person}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <div class="right">
      <button
        class="account"
        class:in={$currentUser != null}
        on:click={() => userMenuOpen.set(true)}
        aria-label={$t("tabbar.menu")}
      >
        {#if $currentUser}
          {#if $currentUser.photo_url}
            <img src={$currentUser.photo_url} alt="" />
          {:else}
            <span class="initial"
              >{$currentUser.first_name?.[0]?.toUpperCase() ?? "·"}</span
            >
          {/if}
          <span class="who">{displayName($currentUser)}</span>
        {:else}
          <span class="tg">✦</span><span class="who">{$t("tabbar.login")}</span>
        {/if}
      </button>
      <div class="clock">
        <span class="time">{timeLabel}</span>
        <span class="date">{dateLabel}</span>
      </div>
      <!-- The window's close control: the whole board shrinks into its circle
           on the dock (see DockView / the layout's morph). -->
      <button
        class="winclose"
        on:click={requestClose}
        aria-label={$t("dock.close")}
        title={$t("dock.close")}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          aria-hidden="true"
        >
          <line
            x1="6"
            y1="6"
            x2="18"
            y2="18"
            stroke-width="2.4"
            stroke-linecap="round"
          />
          <line
            x1="18"
            y1="6"
            x2="6"
            y2="18"
            stroke-width="2.4"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
  </div>

  <div class="strip" bind:this={strip}>
    <nav
      class="tabs"
      class:compact
      class:editing
      class:dragging={dragId != null}
      aria-label={$t("tabbar.views")}
      bind:this={nav}
    >
      {#each $visibleTabs as tab (tab.id)}
        <button
          class="tab"
          class:active={$activeTab === tab.id}
          class:pinned={$pinnedTab === tab.id}
          class:lifted={dragId === tab.id}
          data-tab={tab.id}
          aria-current={$activeTab === tab.id}
          aria-pressed={$pinnedTab === tab.id}
          title={$pinnedTab === tab.id
            ? $t("tabbar.pinnedHint")
            : $t("tabbar.holdHint")}
          animate:flip={{ duration: FLIP_MS }}
          on:click={() => onTabClick(tab.id)}
          on:pointerdown={(e) => onTabDown(e, tab.id)}
          on:contextmenu={(e) => {
            if (armed) e.preventDefault();
          }}
        >
          <!-- Edit mode: the ✕ hides this tab (never the last one). A stopped
               pointerdown keeps it from arming a hold or a drag. -->
          {#if editing && $visibleTabs.length > 1}
            <span
              class="xbtn"
              role="button"
              tabindex="0"
              aria-label={$t("tabbar.removeTab", { tab: $t(tab.labelKey) })}
              title={$t("tabbar.removeTab", { tab: $t(tab.labelKey) })}
              on:pointerdown|stopPropagation
              on:click|stopPropagation={() => removeTab(tab.id)}
              on:keydown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  removeTab(tab.id);
                }
              }}>&times;</span
            >
          {/if}
          <span class="glyph">{tab.glyph}</span>
          <span class="label">{$t(tab.labelKey)}</span>
          <!-- Pin affordance: the active tab always shows a pin — muted while
             unpinned (tap to park the kiosk here), accent once pinned. A
             stopped pointerdown keeps it from arming the long-press timer. -->
          {#if $pinnedTab === tab.id || $activeTab === tab.id}
            <span
              class="pinbtn"
              class:on={$pinnedTab === tab.id}
              role="button"
              tabindex="0"
              aria-label={$pinnedTab === tab.id
                ? $t("tabbar.unpinTab", { tab: $t(tab.labelKey) })
                : $t("tabbar.pinTab", { tab: $t(tab.labelKey) })}
              title={$pinnedTab === tab.id
                ? $t("tabbar.unpinView")
                : $t("tabbar.pinView")}
              on:pointerdown|stopPropagation
              on:click|stopPropagation={() => togglePin(tab.id)}
              on:keydown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  togglePin(tab.id);
                }
              }}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path
                  d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"
                />
              </svg>
            </span>
          {/if}
          {#if $pinnedTab !== tab.id && $activeTab === tab.id && $autoRotates}
            <span class="rail">
              <span
                class="fill"
                class:paused={!$rotating}
                style="transform: scaleX({$rotating ? $flipProgress : 1});"
              ></span>
            </span>
          {/if}
        </button>
      {/each}
      {#if $hiddenTabs.length}
        <!-- Sticks to the strip's right edge, so it stays reachable while
             the tabs scroll under it. -->
        <button
          class="add"
          class:open={addOpen}
          aria-label={$t("tabbar.addTab")}
          title={$t("tabbar.addTab")}
          aria-expanded={addOpen}
          on:click={() => {
            addOpen = !addOpen;
            editing = false;
          }}>+</button
        >
      {/if}
    </nav>

    {#if addOpen && $hiddenTabs.length}
      <div class="addmenu" role="menu" aria-label={$t("tabbar.addMenu")}>
        <div class="addmenu__title">{$t("tabbar.addMenu")}</div>
        {#each $hiddenTabs as tab (tab.id)}
          <button
            type="button"
            class="addmenu__item"
            role="menuitem"
            on:click={() => addTab(tab.id)}
          >
            <span class="glyph">{tab.glyph}</span>
            <span>{$t(tab.labelKey)}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</header>

<svelte:window on:pointerdown={onWindowDown} />

{#if statusConfirmOpen}
  <StatusConfirm
    on:close={() => (statusConfirmOpen = false)}
    on:accept={() => {
      statusConfirmOpen = false;
      setTabShown("status", true);
    }}
  />
{/if}

<style>
  .bar {
    flex: 0 0 auto;
    /* Sides align with the surface's frame below (the same clamp). */
    padding: 0.7rem clamp(0.4rem, 2vw, 1.4rem) 0;
    /* `max-height` (a value safely above the real header height) lets the bar
       collapse smoothly so the board reclaims the space when idle. */
    max-height: 16rem;
    overflow: hidden;
    transition:
      opacity 0.5s ease,
      max-height 0.5s ease,
      padding 0.5s ease;
  }
  .bar.idle {
    opacity: 0;
    max-height: 0;
    padding-top: 0;
    padding-bottom: 0;
    pointer-events: none;
  }
  /* The bar clips (overflow hidden) so it can collapse when idle; while the
     suggestion panel is open it must be allowed to hang below the header.
     Going idle blurs the field first, so the collapse always clips again. */
  .bar.suggest-open {
    overflow: visible;
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .brand {
    align-self: center;
    display: flex;
    align-items: center;
    min-height: 2.6rem; /* matches the account chip so the row is balanced */
  }
  .right {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  /* Search field: a clean pill centered between the brand and the account,
     above the tabs and the board it filters. */
  .search {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    max-width: 26rem;
    margin: 0 0.5rem;
    display: flex;
    align-items: center;
  }
  .search__icon {
    position: absolute;
    left: 0.75rem;
    width: 1rem;
    height: 1rem;
    color: var(--muted);
    pointer-events: none;
  }
  .search__input {
    width: 100%;
    height: 2.4rem;
    padding: 0 2.2rem;
    border-radius: 999px;
    border: 1.5px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font-size: 0.95rem;
    font-family: inherit;
    -webkit-appearance: none;
    appearance: none;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease,
      background 0.15s ease;
  }
  .search__input::placeholder {
    color: var(--muted);
  }
  .search__input:focus {
    outline: none;
    background: var(--card);
    border-color: var(--teal);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--teal) 20%, transparent);
  }
  /* Hide the browser's native ✕ — we render our own, consistently styled. */
  .search__input::-webkit-search-cancel-button {
    -webkit-appearance: none;
  }
  .search__clear {
    position: absolute;
    right: 0.5rem;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 1.15rem;
    line-height: 1;
    color: var(--muted);
    background: transparent;
  }
  .search__clear:hover {
    background: var(--line);
    color: var(--ink);
  }
  .search__clear:active {
    transform: scale(0.9);
  }

  /* Suggestion dropdown: category + people chips, tappable at kiosk sizes. */
  .suggest {
    position: absolute;
    top: calc(100% + 0.45rem);
    left: 0;
    right: 0;
    z-index: 40;
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 16px;
    box-shadow:
      var(--shadow-soft),
      0 12px 32px rgba(0, 0, 0, 0.14);
    padding: 0.55rem 0.7rem 0.7rem;
    max-height: min(46vh, 20rem);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .suggest__group {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 0.45rem 0.15rem 0.35rem;
  }
  .suggest__group:first-child {
    margin-top: 0.1rem;
  }
  .suggest__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.38rem;
    padding: 0.34rem 0.75rem 0.34rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font-size: 0.88rem;
    font-weight: 600;
    font-family: inherit;
    transition:
      border-color 0.15s ease,
      background 0.15s ease;
  }
  .chip:active {
    transform: scale(0.95);
  }
  .chip.on {
    border-color: var(--teal);
    background: color-mix(in srgb, var(--teal) 14%, var(--card));
    color: var(--teal-deep);
  }
  .chip__dot {
    width: 0.62rem;
    height: 0.62rem;
    border-radius: 50%;
    background: var(--dot, var(--line));
    flex: 0 0 auto;
  }
  .chip__face {
    width: 1.2rem;
    height: 1.2rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--teal);
    color: #fff;
    font-size: 0.62rem;
    font-weight: 700;
    flex: 0 0 auto;
  }
  .account {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.35rem 0.75rem 0.35rem 0.4rem;
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink-soft);
    max-width: 11rem;
  }
  .account.in {
    color: var(--teal-deep);
  }
  .account:active {
    transform: scale(0.96);
  }
  .account img,
  .account .initial,
  .account .tg {
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 50%;
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    object-fit: cover;
    background: var(--teal);
    color: #fff;
    font-size: 0.9rem;
    font-weight: 700;
  }
  .account .who {
    font-size: 0.86rem;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .brand .logo {
    height: 32px;
    width: auto;
    max-width: 40vw;
    object-fit: contain;
    display: block;
  }
  .brand .wordmark {
    display: inline-block;
    font-family: var(--font-logo);
    font-size: 1.55rem;
    font-weight: 500;
    letter-spacing: 0.05em;
    color: var(--teal-deep);
    line-height: 1;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 48vw;
  }
  .winclose {
    flex: 0 0 auto;
    width: 2.1rem;
    height: 2.1rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--muted);
    background: var(--paper);
    transition:
      color 0.15s ease,
      background 0.15s ease;
  }
  .winclose svg {
    width: 1rem;
    height: 1rem;
  }
  .winclose:hover {
    color: var(--ink);
    background: var(--line);
  }
  .winclose:active {
    transform: scale(0.9);
  }

  .clock {
    text-align: right;
    line-height: 1.1;
  }
  .clock .time {
    font-variant-numeric: tabular-nums;
    font-size: 1.05rem;
    color: var(--ink);
    font-weight: 600;
  }
  .clock .date {
    display: block;
    color: var(--muted);
    font-size: 0.78rem;
  }

  /* Narrow portrait screens: strip the header down to search + account —
     the clock and the title go, so the search bar owns the row. */
  @media (max-width: 560px) {
    .account .who {
      display: none;
    }
    .clock {
      display: none;
    }
    /* The title goes; a caretaker's custom logo (an image) stays. */
    .brand .wordmark {
      display: none;
    }
    .brand {
      min-height: 0;
    }
    .brand:not(:has(.logo)) {
      display: none;
    }
    .top {
      gap: 0.5rem;
    }
    .search {
      margin: 0;
      max-width: none;
    }
    .search__input {
      height: 2.7rem;
      font-size: 1.05rem;
      padding: 0 2.3rem;
    }
    .search__icon {
      width: 1.15rem;
      height: 1.15rem;
    }
  }

  /* A single row that shares the width while the tabs fit and scrolls
     sideways (scrollbar hidden, finger or wheel) once they don't; `.compact`
     is the script's verdict that the names no longer fit — the glyphs carry
     the row alone (which is also the phone layout). */
  .strip {
    position: relative; /* anchors the "+" menu below the strip */
  }
  .tabs {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    gap: 0.4rem;
    margin-top: 0.35rem;
    padding-top: 0.45rem; /* room for the ✕ badges and the lifted tab */
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    overscroll-behavior-x: contain;
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
  .tabs.compact .tab .label {
    display: none;
  }
  .tabs.compact .tab .glyph {
    font-size: 1.25rem;
  }
  /* Icon sits inline with the label so the tab strip is a single thin row. */
  .tab {
    position: relative;
    flex: 1 0 auto;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.4rem 0.6rem 0.5rem;
    min-height: 2.2rem;
    border-radius: 12px 12px 0 0;
    color: var(--muted);
    white-space: nowrap;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    transition:
      color 0.25s ease,
      background 0.25s ease,
      transform 0.15s ease,
      box-shadow 0.15s ease;
  }
  /* Lifted by a hold or a drag: it rides above its neighbours while they
     glide (flip) into the slots it leaves and takes. */
  .tab.lifted {
    z-index: 2;
    color: var(--teal-deep);
    background: var(--card);
    transform: scale(1.06);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.16);
    cursor: grabbing;
  }
  .tabs.dragging .tab {
    transition:
      color 0.25s ease,
      background 0.25s ease;
  }
  .tabs.dragging .tab.lifted {
    transition:
      transform 0.15s ease,
      box-shadow 0.15s ease;
  }
  /* Edit mode: every tab wears a ✕ at its corner (DockView's edit mode, in
     miniature). */
  .xbtn {
    position: absolute;
    top: -0.35rem;
    left: -0.25rem;
    width: 1.35rem;
    height: 1.35rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--ink);
    color: var(--paper);
    font-size: 1rem;
    line-height: 1;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
    z-index: 3;
  }
  .xbtn:active {
    transform: scale(0.88);
  }
  .tabs.editing .tab:not(.active) {
    color: var(--ink-soft);
  }
  /* The "+" rides the right edge over the scrolling tabs. */
  .add {
    position: sticky;
    right: 0;
    flex: 0 0 auto;
    align-self: center;
    width: 2rem;
    height: 2rem;
    margin-left: 0.2rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 1.35rem;
    line-height: 1;
    color: var(--muted);
    background: var(--paper);
    box-shadow: -8px 0 10px -6px var(--paper);
    z-index: 3;
    transition:
      color 0.15s ease,
      background 0.15s ease;
  }
  .add:hover,
  .add.open {
    color: var(--teal-deep);
    background: var(--card);
  }
  .add:active {
    transform: scale(0.9);
  }
  .addmenu {
    position: absolute;
    top: calc(100% + 0.35rem);
    right: 0;
    z-index: 40;
    min-width: 12rem;
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 16px;
    box-shadow:
      var(--shadow-soft),
      0 12px 32px rgba(0, 0, 0, 0.14);
    padding: 0.45rem;
  }
  .addmenu__title {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 0.3rem 0.5rem 0.4rem;
  }
  .addmenu__item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.7rem;
    border-radius: 10px;
    color: var(--ink);
    font-size: 0.95rem;
    font-weight: 600;
    font-family: inherit;
    text-align: left;
    background: transparent;
  }
  .addmenu__item .glyph {
    font-size: 1.1rem;
    width: 1.4rem;
    text-align: center;
  }
  .addmenu__item:hover {
    background: var(--paper);
  }
  .addmenu__item:active {
    transform: scale(0.98);
  }
  .tab .glyph {
    font-size: 1.05rem;
    line-height: 1;
  }
  .tab .label {
    font-size: 0.9rem;
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  .tab.active {
    color: var(--teal-deep);
    background: var(--card);
    box-shadow: var(--shadow-soft);
  }
  /* Pinned: a steady accent + the pin glyph, no rotation rail. */
  .tab.pinned {
    color: var(--teal-deep);
  }
  /* Tappable pin on the active tab: muted while unpinned (an invitation),
     accent once the kiosk is parked here. */
  .pinbtn {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 1.6rem;
    height: 1.6rem;
    margin-left: 0.05rem;
    border-radius: 50%;
    color: var(--muted);
    opacity: 0.55;
    transition:
      color 0.15s ease,
      opacity 0.15s ease,
      transform 0.1s ease;
  }
  .pinbtn svg {
    width: 0.9rem;
    height: 0.9rem;
  }
  .pinbtn.on {
    color: var(--teal);
    opacity: 1;
  }
  .pinbtn:active {
    transform: scale(0.88);
  }

  .rail {
    position: absolute;
    left: 12%;
    right: 12%;
    bottom: 0.28rem;
    height: 3px;
    border-radius: 3px;
    background: var(--line);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    width: 100%;
    transform-origin: left center;
    background: var(--teal);
    transition: transform 0.25s linear;
  }
  .fill.paused {
    background: var(--note-coral);
    transition: none;
  }
</style>
