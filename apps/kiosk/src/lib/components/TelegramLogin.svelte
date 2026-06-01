<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Renders the official Telegram Login Widget when a bot username is
  // configured. The widget calls a global callback with the authenticated
  // user, which we persist. Without configuration we explain how to enable it
  // (and, in dev, the VITE_DEV_TELEGRAM_USER_* fallback already auto-logs in).
  //
  // Login domain: the backing bot must register `hubs.network` via @BotFather's
  // /setdomain. Telegram honours the registered domain and its subdomains, so a
  // single /setdomain hubs.network authorises every hub kiosk served from a
  // *.hubs.network origin.
  import { onMount } from "svelte";
  import {
    botUsername,
    setUser,
    logout,
    displayName,
    telegramUser,
    type TelegramUser,
  } from "$lib/auth";

  let host: HTMLDivElement;

  onMount(() => {
    // Global hook the widget invokes: data-onauth="onKioskTelegramAuth(user)".
    (window as any).onKioskTelegramAuth = (user: TelegramUser) => setUser(user);

    if (botUsername && host) {
      const s = document.createElement("script");
      s.async = true;
      s.src = "https://telegram.org/js/telegram-widget.js?22";
      s.setAttribute("data-telegram-login", botUsername);
      s.setAttribute("data-size", "large");
      s.setAttribute("data-radius", "12");
      s.setAttribute("data-userpic", "true");
      s.setAttribute("data-request-access", "write");
      s.setAttribute("data-onauth", "onKioskTelegramAuth(user)");
      host.appendChild(s);
    }
  });
</script>

<div class="login">
  {#if $telegramUser}
    <div class="glyph" aria-hidden="true">✓</div>
    <h3>Logged in</h3>
    <p>
      You're signed in as <strong>{displayName($telegramUser)}</strong> and can edit
      what's on the screen.
    </p>
    <button class="logout" on:click={logout}>Log out</button>
  {:else}
    <div class="glyph" aria-hidden="true">✦</div>
    <h3>Log in with Telegram</h3>
    <p>
      Sign in to add and edit what's on the screen. Viewing stays open to all.
    </p>

    {#if botUsername}
      <div class="widget" bind:this={host}></div>
    {:else}
      <p class="hint">
        Telegram login isn't configured yet. Set
        <code>VITE_TELEGRAM_BOT_USERNAME</code> in the root <code>.env</code> to the
        bot that backs this hub.
      </p>
    {/if}
  {/if}
</div>

<style>
  .login {
    text-align: center;
    padding: 0.5rem 0.25rem;
  }
  .glyph {
    font-size: 2rem;
    color: var(--teal);
  }
  h3 {
    margin: 0.4rem 0 0.3rem;
    font-size: 1.3rem;
    color: var(--ink);
  }
  p {
    color: var(--ink-soft);
    line-height: 1.5;
    margin: 0 auto 1rem;
    max-width: 22rem;
  }
  .widget {
    display: flex;
    justify-content: center;
    min-height: 48px;
  }
  .hint {
    font-size: 0.9rem;
    color: var(--muted);
  }
  code {
    background: var(--paper-deep);
    border-radius: 6px;
    padding: 0.1em 0.4em;
    font-size: 0.85em;
  }
  .logout {
    min-height: 48px;
    padding: 0 1.6rem;
    border-radius: 14px;
    font-weight: 700;
    color: var(--ink);
    background: var(--paper-deep);
  }
  .logout:active {
    transform: scale(0.97);
  }
</style>
