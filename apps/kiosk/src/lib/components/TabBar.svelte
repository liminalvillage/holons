<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import {
    visibleTabs,
    activeTab,
    selectTab,
    holonName,
    brandName,
    brandLogo,
    userMenuOpen,
    now,
    rotating,
    flipProgress,
  } from "$lib/stores";
  import { telegramUser, displayName } from "$lib/auth";

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

<header class="bar">
  <div class="top">
    <div class="brand">
      {#if $brandLogo}
        <img class="logo" src={$brandLogo} alt={brandText || "Kiosk"} />
      {:else}
        <span class="wordmark">{brandText || "kiosk"}</span>
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
        aria-current={$activeTab === tab.id}
        on:click={() => selectTab(tab.id)}
      >
        <span class="glyph">{tab.glyph}</span>
        <span class="label">{tab.label}</span>
        {#if $activeTab === tab.id}
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
    padding: 1.1rem 1.4rem 0;
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
  }

  .tabs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    margin-top: 0.9rem;
  }
  .tab {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    padding: 0.7rem 0.5rem 0.9rem;
    min-height: var(--tap);
    border-radius: 14px 14px 0 0;
    color: var(--muted);
    transition:
      color 0.25s ease,
      background 0.25s ease;
  }
  .tab .glyph {
    font-size: 1.25rem;
    line-height: 1;
  }
  .tab .label {
    font-size: 0.95rem;
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  .tab.active {
    color: var(--teal-deep);
    background: var(--card);
    box-shadow: var(--shadow-soft);
  }

  .rail {
    position: absolute;
    left: 12%;
    right: 12%;
    bottom: 0.45rem;
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
