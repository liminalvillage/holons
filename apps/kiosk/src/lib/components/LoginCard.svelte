<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import Icon from "$lib/components/Icon.svelte";
  // The sign-in card. Your own Nostr key is the suggested path (paste an
  // nsec or create one — the key is resolved client-side and adopted for the
  // session, see auth.ts `loginWithKey`); Telegram (full-page OIDC redirect,
  // see src/lib/server/telegramAuth.ts) and an Ethereum wallet are the other
  // ways in. A key login may be REMEMBERED on this device behind a PIN
  // (lib/rememberKey.ts) — opt-in, since a kiosk is usually a shared screen —
  // and a remembered key greets the person with the PIN step on the next
  // visit. Viewing stays open to all; editing requires signing in.
  import { onMount, tick } from "svelte";
  import { get } from "svelte/store";
  import {
    login,
    logout,
    loginWithKey,
    resumeKeyLogin,
    displayName,
    currentUser,
  } from "$lib/auth";
  import { sessionKeyPub } from "$lib/sessionKey";
  import { isWalletAvailable, signInWithEthereum } from "$lib/login/ethereum";
  import { AuthUiError, type ProviderLogin } from "$lib/login/types";
  import {
    forgetRememberedKey,
    readRememberedKey,
    rememberKey,
    unlockRememberedKey,
    type RememberedKey,
  } from "$lib/rememberKey";
  import NostrKeySheet from "./NostrKeySheet.svelte";
  import PinSheet from "./PinSheet.svelte";
  import { t } from "$lib/i18n";

  let sheet: "none" | "nostr" | "pin" | "unlock" = "none";
  let busy = false;
  let error = "";
  let errorSoft = false;
  let walletOk = false;
  /** "Stay signed in on this device" — off unless asked. */
  let stay = false;
  /** A key login waiting for its PIN before it is remembered and adopted. */
  let pending: ProviderLogin | null = null;
  let remembered: RememberedKey | null = null;
  let pinError = "";
  let wrongPins = 0;
  onMount(() => {
    walletOk = isWalletAvailable();
    remembered = readRememberedKey();
    // A remembered key with no live session: the PIN step is the front door.
    if (remembered && !get(sessionKeyPub)) sheet = "unlock";
  });

  async function finish(fn: () => Promise<ProviderLogin> | ProviderLogin) {
    if (busy) return;
    busy = true;
    error = "";
    try {
      const providerLogin = await fn();
      if (stay) {
        pending = providerLogin;
        pinError = "";
        sheet = "pin";
        return;
      }
      await loginWithKey(providerLogin);
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

  // Sealing is slow on purpose (scrypt); let the busy state paint first.
  async function onPinSet(pin: string) {
    if (!pending || busy) return;
    busy = true;
    pinError = "";
    try {
      await tick();
      await new Promise((r) => setTimeout(r, 30));
      rememberKey(pending.privateKey, pin, {
        pubkey: pending.publicKey,
        provider:
          pending.identity.provider === "ethereum" ? "ethereum" : "nostr",
        label: pending.identity.label,
      });
      await loginWithKey(pending);
      pending = null;
    } catch (e) {
      pinError = (e as Error)?.message || "Could not save the key.";
    } finally {
      busy = false;
    }
  }

  async function onUnlock(pin: string) {
    if (!remembered || busy) return;
    busy = true;
    pinError = "";
    try {
      await tick();
      await new Promise((r) => setTimeout(r, 30));
      const secret = unlockRememberedKey(pin, remembered);
      if (!secret) {
        wrongPins += 1;
        pinError = $t("login.pinWrong");
        return;
      }
      await resumeKeyLogin(secret, remembered.provider, remembered.label);
    } finally {
      busy = false;
    }
  }

  function forget() {
    forgetRememberedKey();
    remembered = null;
    wrongPins = 0;
    pinError = "";
    sheet = "none";
  }

  function skipPin() {
    // They changed their mind about remembering: sign in without it.
    const p = pending;
    pending = null;
    stay = false;
    sheet = "none";
    if (p) void loginWithKey(p);
  }
</script>

<div class="login">
  {#if $currentUser}
    <div class="glyph" aria-hidden="true"><Icon name="check" /></div>
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
  {:else if sheet === "pin"}
    <PinSheet
      mode="set"
      error={pinError}
      {busy}
      on:pin={(e) => onPinSet(e.detail)}
      on:back={skipPin}
    />
  {:else if sheet === "unlock" && remembered}
    <PinSheet
      mode="enter"
      label={remembered.label || `${remembered.pubkey.slice(0, 8)}…`}
      error={pinError}
      {busy}
      canForget={wrongPins >= 3}
      on:pin={(e) => onUnlock(e.detail)}
      on:back={() => (sheet = "none")}
      on:forget={forget}
    />
  {:else}
    <div class="glyph" aria-hidden="true"><Icon name="star" /></div>
    <h3>{$t("login.title")}</h3>
    <p>{$t("login.lead")}</p>

    <button
      class="primary-key"
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
      <span>{$t("login.nostrLead")}</span>
    </button>
    <p class="hint">{$t("login.nostrHint")}</p>

    <div class="divider" role="separator">
      <span>{$t("login.orOther")}</span>
    </div>

    <div class="tiles">
      <button class="tile" disabled={busy} on:click={login}>
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
        <span class="tile__label">{$t("login.telegramTile")}</span>
        <span class="tile__hint">{$t("login.telegramHint")}</span>
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

    <label class="stay">
      <input type="checkbox" bind:checked={stay} />
      <span>
        <span class="stay__label">{$t("login.stay")}</span>
        <span class="stay__hint">{$t("login.stayHint")}</span>
      </span>
    </label>
    {#if remembered}
      <button class="link" on:click={() => (sheet = "unlock")}>
        {$t("login.pinEnterBody", {
          label: remembered.label || `${remembered.pubkey.slice(0, 8)}…`,
        })}
      </button>
    {/if}
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
  .primary-key {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 48px;
    padding: 0 1.6rem;
    border-radius: 14px;
    font-weight: 700;
    color: #fff;
    background: var(--teal);
  }
  .primary-key svg {
    width: 1.4rem;
    height: 1.4rem;
  }
  .primary-key:active {
    transform: scale(0.97);
  }
  .primary-key:disabled {
    opacity: 0.6;
  }
  .hint {
    margin: 0.4rem auto 0;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .tile .tg {
    color: #2aabee;
  }
  .stay {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    max-width: 22rem;
    margin: 1rem auto 0;
    text-align: left;
    cursor: pointer;
  }
  .stay input {
    width: 1.2rem;
    height: 1.2rem;
    margin-top: 0.15rem;
    flex: none;
  }
  .stay__label {
    display: block;
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--ink);
  }
  .stay__hint {
    display: block;
    font-size: 0.75rem;
    line-height: 1.3;
    color: var(--muted);
  }
  .link {
    margin-top: 0.8rem;
    min-height: 44px;
    background: transparent;
    color: var(--ink-soft);
    font-size: 0.85rem;
    text-decoration: underline;
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
