// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Who is signed in on this kiosk. Editing is gated behind being signed in;
// viewing is always open. Two kinds of identity resolve into ONE store:
//
//  - Telegram (suggested): OpenID Connect via our serverless endpoints (see
//    src/lib/server/telegramAuth.ts and src/routes/api/auth/*) — the browser
//    is redirected to Telegram and back, the server verifies the id_token and
//    sets an httpOnly session cookie.
//  - Your own key (nsec import or Ethereum wallet, see src/lib/login/*): the
//    key is resolved client-side, ownership is proven to the server with a
//    NIP-98 event (POST /api/auth/key) for the same session cookie, and the
//    key is adopted in-memory as this session's signing identity.
//
// By default we never hold a Telegram user's signing key — writes are signed
// by the kiosk's own device key (see holosphere.ts) and record the user as the
// actor via `actingAs`, mirroring how the bot writes on behalf of chat
// members. A key login (nsec, passkey, wallet) adopts the user's own key for
// the session (sessionKey.ts); a person's several keys are tied together by
// kind-31926 attestations, never by a server-held vault. Adopted keys live in
// memory only and are dropped on logout — key users fall back to the device
// key + `actingAs` after a reload, same as everyone else.

import { writable, derived, get } from "svelte/store";
import { shortId, userName } from "@holons/core/identity";
import { signAuthEvent } from "@holons/core/auth";
import type { ProviderLogin } from "./login/types";
import { importNostrKey } from "./login/nostrKey";
import { forgetRememberedKey } from "./rememberKey";
import {
  isShortName,
  nameFor,
  profileFor,
  resolveNames,
  setNamesSelf,
} from "./names";

/** The signed-in editor: a Telegram profile, or a bare key identity whose
 *  id (= personal holon id) is the Nostr pubkey hex. */
export interface KioskUser {
  id: number | string;
  provider: "telegram" | "nostr" | "ethereum";
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

/** Kept name-compatible with the old Telegram-only store's consumers. */
export type TelegramUser = KioskUser;

export const currentUser = writable<KioskUser | null>(null);
export const isLoggedIn = derived(currentUser, (u) => u != null);
setNamesSelf(() => get(currentUser));

/** Whether a login overlay is currently requested. */
export const loginOpen = writable<boolean>(false);

function normalize(u: any): KioskUser | null {
  if (!u || u.id == null) return null;
  return {
    id: typeof u.id === "number" ? u.id : Number(u.id) || String(u.id),
    provider: "telegram",
    first_name: u.first_name ?? "",
    last_name: u.last_name,
    username: u.username,
    photo_url: u.photo_url,
  };
}

function keyUser(
  pubkey: string,
  provider: "nostr" | "ethereum",
  label?: string,
): KioskUser {
  return {
    id: pubkey,
    provider,
    // No stand-in: a key user's name is READ — their kind 0 on the relays,
    // their record in a hub they are seated in (`hydrateKeyUser`). Until it
    // arrives the screen shows the short npub through `displayName`.
    first_name: label && !isShortName(label, pubkey) ? label : "",
  };
}

/**
 * Fill a key user's name and picture from what names them — kind 0 first
 * (the person's own profile, set on any Nostr client), else a hub record —
 * once the identity is set. Nothing is persisted here.
 */
async function hydrateKeyUser(pubkey: string): Promise<void> {
  try {
    const found = (await resolveNames([pubkey])).get(pubkey) ?? "";
    const profile = profileFor(pubkey);
    currentUser.update((u) => {
      if (!u || String(u.id) !== pubkey) return u;
      const next = { ...u };
      if (!next.first_name && !isShortName(found, pubkey))
        next.first_name = found;
      if (!next.photo_url && profile?.picture) next.photo_url = profile.picture;
      return next;
    });
  } catch {
    /* offline: the short form stands until the relays answer */
  }
}

/**
 * Resolve the current identity from the server session (or the dev-only
 * auto-login in non-prod). Call once on mount; updates the store reactively.
 */
export async function initAuth(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const res = await fetch("/api/auth/session");
    if (res.ok) {
      const { user, key, nostrPrivateKey } = await res.json();
      currentUser.set(
        key ? keyUser(key.pubkey, key.provider) : normalize(user),
      );
      if (key) void hydrateKeyUser(key.pubkey);
      // A Telegram login brings its derived key when the server has the
      // secret: adopted in memory, so the person signs as the member the
      // bot already linked to their chats — the same key as on the web.
      // Nothing is persisted here; the cookie re-derives it on every load.
      if (!key && typeof nostrPrivateKey === "string" && nostrPrivateKey) {
        const { adoptSessionKey } = await import("./sessionKey");
        await adoptSessionKey(nostrPrivateKey);
      }
      return;
    }
  } catch {
    /* offline / not logged in */
  }
  currentUser.set(null);
}

/**
 * Begin the Telegram OIDC login (full-page redirect via our /login endpoint).
 * The current location rides along as `returnTo` so the round-trip lands back
 * on the same board, tab and card (`/liminal/tasks?task=…`) — not the root.
 */
export function login(): void {
  if (typeof window === "undefined") return;
  loginOpen.set(false);
  const returnTo =
    window.location.pathname + window.location.search + window.location.hash;
  window.location.href =
    "/api/auth/telegram/login?returnTo=" + encodeURIComponent(returnTo);
}

/**
 * Adopt a key-based provider login: prove key ownership to the server for the
 * session cookie (best effort — identity works locally without it), sign in,
 * and adopt the key in-memory so this session's writes are signed as the user.
 */
export async function loginWithKey(
  providerLogin: ProviderLogin,
): Promise<void> {
  try {
    const url = `${location.origin}/api/auth/key`;
    const event = signAuthEvent(
      { url, method: "POST" },
      providerLogin.privateKey,
    );
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        provider: providerLogin.identity.provider,
      }),
    });
  } catch (err) {
    console.warn(
      "[kiosk] could not mint a server session (continuing locally):",
      err,
    );
  }
  const provider =
    providerLogin.identity.provider === "ethereum" ? "ethereum" : "nostr";
  currentUser.set(
    keyUser(providerLogin.publicKey, provider, providerLogin.identity.label),
  );
  const { adoptSessionKey } = await import("./sessionKey");
  await adoptSessionKey(providerLogin.privateKey);
  void hydrateKeyUser(providerLogin.publicKey);
  loginOpen.set(false);
}

/**
 * Sign back in with a key this device remembered (lib/rememberKey.ts), once
 * its PIN opened it: the same path as a fresh key login, so the session
 * cookie is re-minted and the key adopted in memory.
 */
export async function resumeKeyLogin(
  secretHex: string,
  provider: "nostr" | "ethereum" | "passkey",
  label?: string,
): Promise<void> {
  const providerLogin = importNostrKey(secretHex);
  providerLogin.identity = {
    ...providerLogin.identity,
    provider,
    ...(label ? { label } : {}),
  };
  await loginWithKey(providerLogin);
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/session", { method: "DELETE" });
  } catch {
    /* best effort */
  }
  // Leaving means leaving: a key remembered on this device goes too.
  forgetRememberedKey();
  currentUser.set(null);
  // A shared kiosk must not keep signing as the departed user: drop the
  // paired/adopted session key (in-memory only) along with the identity.
  const { dropSessionKey } = await import("./sessionKey");
  await dropSessionKey();
}

/** Friendly display name for the logged-in user — the kiosk's one name rule. */
export function displayName(u: KioskUser): string {
  return (
    userName(u, { lastName: "initial", idFallback: false, unknown: "" }) ||
    nameFor(u.id) ||
    shortId(u.id)
  );
}

/**
 * `actingAs` resolver for `writeWithIdentity`: the user's personal holon id
 * (their Telegram user id, or their pubkey hex), or null when not logged in.
 */
export function actingAs(): string | null {
  const u = get(currentUser);
  return u ? String(u.id) : null;
}

/** A `BorrowActor` shape for core library borrow/return, or null. */
export function borrowActor(): {
  id: number | string;
  username?: string;
  first_name?: string;
  last_name?: string;
  display_name?: string;
} | null {
  const u = get(currentUser);
  if (!u) return null;
  // A key user with no record yet is named by the resolver; a short form is
  // not a name and is left out so the booking never stores a placeholder.
  const resolved = nameFor(u.id);
  return {
    id: u.id,
    username: u.username,
    first_name: u.first_name,
    last_name: u.last_name,
    ...(!u.first_name && !isShortName(resolved, u.id)
      ? { display_name: resolved }
      : {}),
  };
}
