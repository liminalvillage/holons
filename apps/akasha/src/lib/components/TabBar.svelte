<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import {
    TABS,
    activeTab,
    selectTab,
    holonName,
    now,
    rotating,
    flipProgress,
  } from "$lib/stores";
  import { telegramUser, loginOpen, displayName } from "$lib/auth";

  $: timeLabel = $now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  $: dateLabel = $now.toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
</script>

<header class="bar">
  <div class="top">
    <div class="brand">
      <span class="mark">akasha</span>
      {#if $holonName}<span class="holon">· {$holonName}</span>{/if}
    </div>
    <div class="right">
      <button
        class="account"
        class:in={$telegramUser != null}
        on:click={() => loginOpen.set(true)}
        aria-label="Account"
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

  <nav class="tabs" aria-label="Views">
    {#each TABS as tab, i}
      <button
        class="tab"
        class:active={$activeTab === i}
        aria-current={$activeTab === i}
        on:click={() => selectTab(i)}
      >
        <span class="glyph">{tab.glyph}</span>
        <span class="label">{tab.label}</span>
        {#if $activeTab === i}
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
    align-self: baseline;
  }
  .right {
    display: flex;
    align-items: center;
    gap: 0.9rem;
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
    width: 28px;
    height: 28px;
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
  .brand .mark {
    font-size: 1.05rem;
    letter-spacing: 0.4em;
    text-transform: uppercase;
    color: var(--teal);
    font-weight: 600;
  }
  .brand .holon {
    color: var(--muted);
    margin-left: 0.35rem;
    font-size: 0.95rem;
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
