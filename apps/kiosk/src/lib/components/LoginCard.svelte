<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // The sign-in card. Telegram is the suggested path (full-page OIDC redirect,
  // see src/lib/server/telegramAuth.ts); your own Nostr key and an Ethereum
  // wallet are equal secondary options that resolve a key client-side and land
  // in `loginWithKey` (see auth.ts). Viewing stays open to all; editing
  // requires signing in.
  import { onMount } from "svelte";
  import {
    login,
    logout,
    loginWithKey,
    displayName,
    currentUser,
  } from "$lib/auth";
  import { isWalletAvailable, signInWithEthereum } from "$lib/login/ethereum";
  import { AuthUiError, type ProviderLogin } from "$lib/login/types";
  import NostrKeySheet from "./NostrKeySheet.svelte";
  import { t } from "$lib/i18n";

  let sheet: "none" | "nostr" = "none";
  let busy = false;
  let error = "";
  let errorSoft = false;
  let walletOk = false;
  onMount(() => {
    walletOk = isWalletAvailable();
  });

  async function finish(fn: () => Promise<ProviderLogin> | ProviderLogin) {
    if (busy) return;
    busy = true;
    error = "";
    try {
      await loginWithKey(await fn());
    } catch (e) {
      const err =
        e instanceof AuthUiError
          ? e
          : new AuthUiError((e as Error)?.message || "Sign-in failed.");
      error = err.kind === "cancelled" ? $t("login.cancelled") : err.message;
      errorSoft = err.kind === "cancelled";
    } finally {
      busy = false;
    }
  }
</script>

<div class="login">
  {#if $currentUser}
    <div class="glyph" aria-hidden="true">✓</div>
    <h3>{$t("login.loggedIn")}</h3>
    <p>
      {$t("login.signedInAs", { name: displayName($currentUser) })}
    </p>
    <button class="logout" on:click={logout}>{$t("menu.logout")}</button>
  {:else if sheet === "nostr"}
    <NostrKeySheet
      on:login={(e) => finish(() => e.detail)}
      on:back={() => {
        sheet = "none";
        error = "";
      }}
    />
  {:else}
    <div class="glyph" aria-hidden="true">✦</div>
    <h3>{$t("login.title")}</h3>
    <p>{$t("login.lead")}</p>

    <button class="telegram" disabled={busy} on:click={login}>
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

    <div class="divider" role="separator"><span>{$t("login.orKey")}</span></div>

    <div class="tiles">
      <button
        class="tile"
        disabled={busy}
        on:click={() => {
          sheet = "nostr";
          error = "";
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="8" cy="15" r="4.5" /><path
            d="M11.2 11.8 20 3M16 7l2.5 2.5M13.5 9.5 16 12"
          />
        </svg>
        <span class="tile__label">{$t("login.nostrTile")}</span>
        <span class="tile__hint">{$t("login.nostrHint")}</span>
      </button>
      <button
        class="tile"
        disabled={!walletOk || busy}
        title={!walletOk ? $t("login.ethNoWallet") : undefined}
        on:click={() => finish(signInWithEthereum)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 2.5 5.5 12.4 12 16.2l6.5-3.8L12 2.5Z" /><path
            d="m5.5 13.9 6.5 8.6 6.5-8.6L12 17.7l-6.5-3.8Z"
          />
        </svg>
        <span class="tile__label">{$t("login.ethTile")}</span>
        <span class="tile__hint"
          >{walletOk ? $t("login.ethHint") : $t("login.ethNoWallet")}</span
        >
      </button>
    </div>
  {/if}

  {#if error}
    <p class="error" class:soft={errorSoft} role="alert">{error}</p>
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
  .telegram:disabled {
    opacity: 0.6;
  }
  .tg {
    width: 1.4rem;
    height: 1.4rem;
  }
  .divider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 1.1rem auto 0.8rem;
    max-width: 22rem;
    color: var(--muted);
    font-size: 0.8rem;
  }
  .divider::before,
  .divider::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--line);
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
    max-width: 22rem;
    margin: 0 auto;
  }
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    min-height: 84px;
    padding: 0.7rem 0.5rem 0.6rem;
    border-radius: 14px;
    background: var(--paper-deep);
    color: var(--ink);
  }
  .tile:active {
    transform: scale(0.97);
  }
  .tile:disabled {
    opacity: 0.45;
  }
  .tile svg {
    width: 1.6rem;
    height: 1.6rem;
    color: var(--teal-deep);
  }
  .tile__label {
    font-weight: 700;
    font-size: 0.95rem;
  }
  .tile__hint {
    font-size: 0.72rem;
    line-height: 1.25;
    color: var(--muted);
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
  .error {
    margin: 0.8rem 0 0;
    font-size: 0.85rem;
    color: #9a3b2f;
  }
  .error.soft {
    color: var(--muted);
  }
</style>
