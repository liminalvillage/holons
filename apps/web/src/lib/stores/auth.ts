// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Which provider the current session came from, and the ONE logout.
//
// The secret itself lives in nostrStore (as it always has); this store only
// remembers provider + label so a reload can restore a key-based session
// without any network round-trip, and so menus can say "Passkey" or
// "0x12…abcd" instead of a bare npub.

import { writable, derived, get } from "svelte/store";
import { browser } from "$app/environment";
import type { AuthIdentity, AuthProvider } from "@holons/core/auth";
import { signAuthEvent } from "@holons/core/auth";
import { nostrStore } from "./nostr";
import type { ProviderLogin } from "$lib/auth/types";

const STORAGE_KEY = "holons_auth";

export interface AuthState {
  provider: AuthProvider | null;
  identity: AuthIdentity | null;
}

function readPersisted(): AuthState {
  if (!browser) return { provider: null, identity: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { provider: null, identity: null };
    const parsed = JSON.parse(raw) as AuthState;
    return parsed?.identity?.pubkey
      ? parsed
      : { provider: null, identity: null };
  } catch {
    return { provider: null, identity: null };
  }
}

function persist(state: AuthState) {
  if (!browser) return;
  try {
    if (state.identity)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked — session still works in-memory */
  }
}

function createAuthStore() {
  const store = writable<AuthState>({ provider: null, identity: null });

  /** Best-effort server session so gated APIs (AI breakdown, …) accept us. */
  async function mintServerSession(login: ProviderLogin) {
    try {
      const url = `${location.origin}/api/auth/key`;
      const event = signAuthEvent({ url, method: "POST" }, login.privateKey);
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, provider: login.identity.provider }),
      });
    } catch (err) {
      console.warn(
        "Could not mint a server session (continuing locally):",
        err,
      );
    }
  }

  return {
    subscribe: store.subscribe,

    /** Adopt a provider login: key → nostrStore, provider → here, cookie → server. */
    async completeLogin(login: ProviderLogin): Promise<void> {
      nostrStore.setSessionKey(login.privateKey);
      const state = {
        provider: login.identity.provider,
        identity: login.identity,
      };
      store.set(state);
      persist(state);
      await mintServerSession(login);
    },

    /** Record that a Telegram session is active (key handled by telegramStore). */
    markTelegram(identity: AuthIdentity) {
      const state = { provider: "telegram" as const, identity };
      store.set(state);
      persist(state);
    },

    /**
     * Restore a key-based session from local state alone. Returns the identity
     * when the persisted provider is key-based AND nostrStore holds the
     * matching key; otherwise null (Telegram restores via the cookie).
     */
    restore(): AuthIdentity | null {
      const saved = readPersisted();
      if (!saved.identity || saved.provider === "telegram" || !saved.provider)
        return null;
      const key = nostrStore.getState();
      if (!key.privateKey || key.publicKey !== saved.identity.pubkey)
        return null;
      store.set(saved);
      return saved.identity;
    },

    /** The single logout path: cookie, key, provider, then reload to the splash. */
    async logout(): Promise<void> {
      if (!browser) return;
      try {
        await fetch("/api/auth/session", { method: "DELETE" });
      } catch {
        /* best effort */
      }
      nostrStore.clearKey();
      persist({ provider: null, identity: null });
      store.set({ provider: null, identity: null });
      sessionStorage.setItem("just_logged_out", "true");
      window.location.href = "/";
    },

    getState: () => get(store),
  };
}

export const authStore = createAuthStore();
export const authProvider = derived(authStore, ($s) => $s.provider);
export const authIdentity = derived(authStore, ($s) => $s.identity);
