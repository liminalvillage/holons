// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Telegram identity for the kiosk. Editing is gated behind being "logged in
// with Telegram"; viewing is always open. Login uses Telegram's OpenID Connect
// provider via our serverless endpoints (see src/lib/server/telegramAuth.ts and
// src/routes/api/auth/*): the browser is redirected to Telegram and back, the
// server verifies the id_token and sets an httpOnly session cookie, and the
// client reads the verified identity from /api/auth/session.
//
// We never hold the user's signing key — writes are signed by the kiosk's own
// device key (see holosphere.ts) and record this user as the actor via
// `actingAs`. That mirrors how the bot writes on behalf of chat members.

import { writable, derived, get } from "svelte/store";

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

export const telegramUser = writable<TelegramUser | null>(null);
export const isLoggedIn = derived(telegramUser, (u) => u != null);

/** Whether a login overlay is currently requested. */
export const loginOpen = writable<boolean>(false);

function normalize(u: any): TelegramUser | null {
  if (!u || u.id == null) return null;
  return {
    id: Number(u.id),
    first_name: u.first_name ?? "",
    last_name: u.last_name,
    username: u.username,
    photo_url: u.photo_url,
  };
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
      const { user } = await res.json();
      telegramUser.set(normalize(user));
      return;
    }
  } catch {
    /* offline / not logged in */
  }
  telegramUser.set(null);
}

/** Begin the Telegram OIDC login (full-page redirect via our /login endpoint). */
export function login(): void {
  if (typeof window === "undefined") return;
  loginOpen.set(false);
  window.location.href = "/api/auth/telegram/login";
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/session", { method: "DELETE" });
  } catch {
    /* best effort */
  }
  telegramUser.set(null);
}

/** Friendly display name for the logged-in user. */
export function displayName(u: TelegramUser): string {
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return full || (u.username ? `@${u.username}` : `#${u.id}`);
}

/**
 * `actingAs` resolver for `writeWithIdentity`: the user's personal holon id
 * (their Telegram user id), or null when not logged in.
 */
export function actingAs(): string | null {
  const u = get(telegramUser);
  return u ? String(u.id) : null;
}

/** A `BorrowActor` shape for core library borrow/return, or null. */
export function borrowActor(): {
  id: number | string;
  username?: string;
  first_name?: string;
  last_name?: string;
} | null {
  const u = get(telegramUser);
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    first_name: u.first_name,
    last_name: u.last_name,
  };
}
