<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Login via Telegram's OpenID Connect provider. The button starts a full-page
  // redirect to our /api/auth/telegram/login endpoint, which bounces through
  // Telegram and back to /callback; the server verifies the id_token and sets
  // the session cookie. Viewing stays open to all; editing requires login.
  //
  // Setup: the backing bot needs Web Login configured in @BotFather (client_id
  // + client_secret) and this site's callback registered under Allowed URLs,
  // e.g. https://<hub>.hubs.network/api/auth/telegram/callback.
  import {
    login,
    logout,
    displayName,
    telegramUser,
    type TelegramUser,
  } from "$lib/auth";
  import { t } from "$lib/i18n";
</script>

<div class="login">
  {#if $telegramUser}
    <div class="glyph" aria-hidden="true">✓</div>
    <h3>{$t("login.loggedIn")}</h3>
    <p>
      {$t("login.signedInAs", {
        name: displayName($telegramUser as TelegramUser),
      })}
    </p>
    <button class="logout" on:click={logout}>{$t("menu.logout")}</button>
  {:else}
    <div class="glyph" aria-hidden="true">✦</div>
    <h3>{$t("login.title")}</h3>
    <p>{$t("login.lead")}</p>

    <button class="telegram" on:click={login}>
      <svg
        class="tg"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"
        />
      </svg>
      <span>{$t("menu.loginTelegram")}</span>
    </button>
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
  .telegram {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 48px;
    padding: 0 1.6rem;
    border-radius: 14px;
    font-weight: 700;
    color: #fff;
    background: #2aabee;
  }
  .telegram:active {
    transform: scale(0.97);
  }
  .tg {
    width: 1.4rem;
    height: 1.4rem;
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
