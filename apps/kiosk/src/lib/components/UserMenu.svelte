<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // The single entry point behind the header account chip: identity, the
  // federated toggle, the dashboard link, and Settings — everything that used
  // to clutter the header, now in one menu.
  import { telegramUser, displayName, loginOpen, logout } from "$lib/auth";
  import {
    holonId,
    holonName,
    brandName,
    federated,
    settingsOpen,
    userMenuOpen,
  } from "$lib/stores";
  import { setFederated, dashboardUrl } from "$lib/config";

  $: who = $brandName || $holonName;

  function close() {
    userMenuOpen.set(false);
  }
  function toggleFederated() {
    const next = !$federated;
    setFederated(next);
    federated.set(next);
  }
  function openDashboard() {
    if ($holonId) window.open(dashboardUrl($holonId), "_blank", "noopener");
    close();
  }
  function openSettings() {
    close();
    settingsOpen.set(true);
  }
  function login() {
    close();
    loginOpen.set(true);
  }
</script>

<div class="menu">
  <div class="id">
    {#if $telegramUser}
      {#if $telegramUser.photo_url}
        <img class="avatar" src={$telegramUser.photo_url} alt="" />
      {:else}
        <span class="avatar initial"
          >{$telegramUser.first_name?.[0]?.toUpperCase() ?? "·"}</span
        >
      {/if}
      <div class="idtext">
        <span class="name">{displayName($telegramUser)}</span>
        {#if who}<span class="sub">{who}</span>{/if}
      </div>
    {:else}
      <span class="avatar initial">✦</span>
      <div class="idtext">
        <span class="name">Not signed in</span>
        {#if who}<span class="sub">{who}</span>{/if}
      </div>
    {/if}
  </div>

  <button
    class="row toggle"
    class:on={$federated}
    role="switch"
    aria-checked={$federated}
    on:click={toggleFederated}
  >
    <span class="ico">⇄</span>
    <span class="label">Federated</span>
    <span class="knob"><span class="dot"></span></span>
  </button>

  <button class="row" on:click={openDashboard} disabled={!$holonId}>
    <span class="ico">⬡</span>
    <span class="label">Open full dashboard</span>
    <span class="chev">↗</span>
  </button>

  <button class="row" on:click={openSettings}>
    <span class="ico">⚙</span>
    <span class="label">Settings</span>
    <span class="chev">›</span>
  </button>

  {#if $telegramUser}
    <button class="row danger" on:click={logout}>
      <span class="ico">⏻</span>
      <span class="label">Log out</span>
    </button>
  {:else}
    <button class="row primary" on:click={login}>
      <span class="ico">✦</span>
      <span class="label">Log in with Telegram</span>
    </button>
  {/if}
</div>

<style>
  .menu {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .id {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.2rem 0.2rem 0.7rem;
    border-bottom: 1px solid var(--line);
    margin-bottom: 0.3rem;
  }
  .avatar {
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 50%;
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    object-fit: cover;
    background: var(--teal);
    color: #fff;
    font-size: 1.1rem;
    font-weight: 800;
  }
  .idtext {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    font-size: 1.1rem;
    font-weight: 800;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: 0.85rem;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    width: 100%;
    min-height: 52px;
    padding: 0 0.9rem;
    border-radius: 14px;
    background: var(--paper);
    color: var(--ink);
    text-align: left;
    transition:
      background 0.15s ease,
      transform 0.1s ease;
  }
  .row:active {
    transform: scale(0.98);
  }
  .row:disabled {
    opacity: 0.45;
  }
  .row .ico {
    flex: 0 0 auto;
    width: 1.5rem;
    text-align: center;
    font-size: 1.15rem;
    color: var(--teal-deep);
  }
  .row .label {
    flex: 1;
    font-weight: 700;
    font-size: 1rem;
  }
  .row .chev {
    color: var(--muted);
    font-weight: 700;
  }

  .row.primary {
    background: var(--teal);
    color: #fff;
    box-shadow: var(--shadow-soft);
  }
  .row.primary .ico {
    color: #fff;
  }
  .row.danger .ico {
    color: #9a3b2f;
  }

  /* Federated toggle switch */
  .toggle .knob {
    flex: 0 0 auto;
    width: 44px;
    height: 26px;
    border-radius: 999px;
    background: var(--line);
    position: relative;
    transition: background 0.2s ease;
  }
  .toggle .dot {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    box-shadow: var(--shadow-soft);
    transition: transform 0.2s ease;
  }
  .toggle.on {
    background: #e7f3f1;
  }
  .toggle.on .knob {
    background: var(--teal);
  }
  .toggle.on .dot {
    transform: translateX(18px);
  }
</style>
