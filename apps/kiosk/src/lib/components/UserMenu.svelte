<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // The single entry point behind the header account chip: identity, the
  // dashboard link, and Settings — everything that used to clutter the
  // header, now in one menu. (Federated visibility lives in each view's Show
  // pill — see ScopePill.)
  import { currentUser, displayName, loginOpen, logout } from "$lib/auth";
  import {
    holonId,
    holonName,
    brandName,
    settingsOpen,
    userMenuOpen,
  } from "$lib/stores";
  import { dashboardUrl, resolveMiniapp } from "$lib/config";
  import { showHomePage } from "$lib/home";
  import { keyLinkOpen, sessionKeyPub, dropSessionKey } from "$lib/sessionKey";
  import { t } from "$lib/i18n";

  $: who = $brandName || $holonName;

  function close() {
    userMenuOpen.set(false);
  }
  function openDashboard() {
    if ($holonId) window.open(dashboardUrl($holonId), "_blank", "noopener");
    close();
  }
  function openSettings() {
    close();
    settingsOpen.set(true);
  }
  function goHome() {
    void showHomePage();
  }
  function login() {
    close();
    loginOpen.set(true);
  }
  // The key-link flow only exists when a Mini App is registered (see
  // resolveMiniapp) — otherwise writes stay signed by the device key.
  const canLinkKey = resolveMiniapp() != null;
  function linkKey() {
    close();
    keyLinkOpen.set(true);
  }
  function unlinkKey() {
    void dropSessionKey();
  }
</script>

<div class="menu">
  <div class="id">
    {#if $currentUser}
      {#if $currentUser.photo_url}
        <img class="avatar" src={$currentUser.photo_url} alt="" />
      {:else}
        <span class="avatar initial"
          >{$currentUser.first_name?.[0]?.toUpperCase() ?? "·"}</span
        >
      {/if}
      <div class="idtext">
        <span class="name">{displayName($currentUser)}</span>
        {#if who}<span class="sub">{who}</span>{/if}
      </div>
    {:else}
      <span class="avatar initial">✦</span>
      <div class="idtext">
        <span class="name">{$t("menu.notSignedIn")}</span>
        {#if who}<span class="sub">{who}</span>{/if}
      </div>
    {/if}
  </div>

  <button class="row" on:click={openDashboard} disabled={!$holonId}>
    <span class="ico">⬡</span>
    <span class="label">{$t("menu.dashboard")}</span>
    <span class="chev">↗</span>
  </button>

  <button class="row" on:click={openSettings}>
    <span class="ico">⚙</span>
    <span class="label">{$t("menu.settings")}</span>
    <span class="chev">›</span>
  </button>

  <!-- Leaving a holon is not logging out — the identity and the holon are
       separate — so this is where people look for the way back out. -->
  <button class="row" on:click={goHome} disabled={!$holonId}>
    <span class="ico">⌂</span>
    <span class="label">{$t("menu.homePage")}</span>
    <span class="chev">›</span>
  </button>

  {#if $currentUser}
    {#if $sessionKeyPub}
      <button class="row" on:click={unlinkKey}>
        <span class="ico">🔑</span>
        <span class="label"
          >{$t("menu.signingAs", {
            key: `${$sessionKeyPub.slice(0, 8)}…`,
          })}</span
        >
        <span class="chev">✕</span>
      </button>
    {:else if canLinkKey && $currentUser.provider === "telegram"}
      <button class="row" on:click={linkKey}>
        <span class="ico">🔑</span>
        <span class="label">{$t("menu.linkKey")}</span>
        <span class="chev">›</span>
      </button>
    {/if}
    <button class="row danger" on:click={logout}>
      <span class="ico">⏻</span>
      <span class="label">{$t("menu.logout")}</span>
    </button>
  {:else}
    <button class="row primary" on:click={login}>
      <span class="ico">✦</span>
      <span class="label">{$t("menu.login")}</span>
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
</style>
