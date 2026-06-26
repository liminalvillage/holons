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
    now,
    rotating,
    idle,
    flipProgress,
  } from "$lib/stores";
  import type { TabId } from "$lib/stores";
  import { telegramUser, displayName } from "$lib/auth";

  // Long-press a tab to (un)pin the kiosk to it. A press that crosses ~half a
  // second fires the pin and swallows the click that follows, so the same
  // gesture never both pins and navigates.
  const LONG_PRESS_MS = 480;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressed = false;

  function onTabDown(e: PointerEvent, id: TabId) {
    if (e.button != null && e.button !== 0) return;
    longPressed = false;
    cancelPress();
    pressTimer = setTimeout(() => {
      longPressed = true;
      togglePin(id);
      try {
        navigator.vibrate?.(15);
      } catch {
        /* haptics are best-effort */
      }
    }, LONG_PRESS_MS);
  }
  function cancelPress() {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  }
  function onTabClick(id: TabId) {
    if (longPressed) {
      longPressed = false; // this click closes out the long-press; don't navigate
      return;
    }
    selectTab(id);
  }

  $: timeLabel = $now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  $: dateLabel = $now.toLocaleDateString([], {
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
<header class="bar" class:idle={$idle} aria-hidden={$idle}>
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
        placeholder="Search…"
        aria-label="Search visible content"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        bind:value={$searchQuery}
      />
      {#if $searchQuery}
        <button
          type="button"
          class="search__clear"
          on:click={() => searchQuery.set("")}
          aria-label="Clear search">&times;</button
        >
      {/if}
    </div>

    <div class="right">
      <button
        class="account"
        class:in={$telegramUser != null}
        on:click={() => userMenuOpen.set(true)}
        aria-label="Menu"
      >
        {#if $telegramUser}
          {#if $telegramUser.photo_url}
            <img src={$telegramUser.photo_url} alt="" />
          {:else}
            <span class="initial"
              >{$telegramUser.first_name?.[0]?.toUpperCase() ?? "·"}</span
            >
          {/if}
          <span class="who">{displayName($telegramUser)}</span>
        {:else}
          <span class="tg">✦</span><span class="who">Log in</span>
        {/if}
      </button>
      <div class="clock">
        <span class="time">{timeLabel}</span>
        <span class="date">{dateLabel}</span>
      </div>
    </div>
  </div>

  <nav
    class="tabs"
    aria-label="Views"
    style="grid-template-columns: repeat({$visibleTabs.length}, 1fr);"
  >
    {#each $visibleTabs as tab (tab.id)}
      <button
        class="tab"
        class:active={$activeTab === tab.id}
        class:pinned={$pinnedTab === tab.id}
        aria-current={$activeTab === tab.id}
        aria-pressed={$pinnedTab === tab.id}
        title={$pinnedTab === tab.id
          ? "Pinned — long-press to unpin"
          : "Long-press to pin"}
        on:click={() => onTabClick(tab.id)}
        on:pointerdown={(e) => onTabDown(e, tab.id)}
        on:pointerup={cancelPress}
        on:pointerleave={cancelPress}
        on:pointercancel={cancelPress}
      >
        <span class="glyph">{tab.glyph}</span>
        <span class="label">{tab.label}</span>
        {#if $pinnedTab === tab.id}
          <svg
            class="pin"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"
            />
          </svg>
        {:else if $activeTab === tab.id}
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
  </nav>
</header>

<style>
  .bar {
    flex: 0 0 auto;
    padding: 0.7rem 1.4rem 0;
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

  /* Narrow portrait screens: collapse the header so it never clips. */
  @media (max-width: 560px) {
    .account .who {
      display: none;
    }
    .brand .wordmark {
      font-size: 1.2rem;
    }
    .search {
      margin: 0 0.35rem;
    }
    .search__input {
      height: 2.2rem;
      padding: 0 2rem;
    }
  }

  .tabs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.4rem;
    margin-top: 0.55rem;
  }
  /* Icon sits inline with the label so the tab strip is a single thin row. */
  .tab {
    position: relative;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.4rem 0.6rem 0.5rem;
    min-height: 2.2rem;
    border-radius: 12px 12px 0 0;
    color: var(--muted);
    transition:
      color 0.25s ease,
      background 0.25s ease;
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
  .tab .pin {
    width: 0.9rem;
    height: 0.9rem;
    flex: 0 0 auto;
    color: var(--teal);
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
