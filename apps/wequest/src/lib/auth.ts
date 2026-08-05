// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Telegram identity for WeQuest — same server-verified OIDC flow as the kiosk
// (see src/lib/server/telegramAuth.ts and src/routes/api/auth/*): the browser
// is redirected to Telegram and back, the server verifies the id_token and
// sets an httpOnly session cookie, and the client reads the verified identity
// from /api/auth/session.
//
// We never hold the user's signing key — writes are signed by the device key
// (holosphere.ts) and record this user as the actor via `actingAs`. The
// resolved session identity is mirrored into the sync config (`setUser`) so
// everything that already reads `resolveUserId()` keeps working. An explicit
// `?user=` in the URL stays a dev override and beats the session.

import { writable, derived } from "svelte/store";
import { setUser } from "./config";

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

export const telegramUser = writable<TelegramUser | null>(null);
export const isLoggedIn = derived(telegramUser, (u) => u != null);

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

export function displayName(u: TelegramUser): string {
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return full || (u.username ? `@${u.username}` : `#${u.id}`);
}

/**
 * Resolve the current identity from the server session and mirror it into the
 * sync config. Call once on mount; resolves once the identity is known.
 */
export async function initAuth(): Promise<TelegramUser | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch("/api/auth/session");
    if (res.ok) {
      const { user } = await res.json();
      const u = normalize(user);
      telegramUser.set(u);
      // Session identity becomes the acting identity — unless the URL pins an
      // explicit dev override.
      const override = new URLSearchParams(window.location.search).get("user");
      if (u && !override) setUser(String(u.id), displayName(u));
      return u;
    }
  } catch {
    /* offline / static host without functions — dev identity flow remains */
  }
  telegramUser.set(null);
  return null;
}

/** Begin the Telegram OIDC login (full-page redirect via our /login endpoint). */
export function login(): void {
  if (typeof window === "undefined") return;
  window.location.href = "/api/auth/telegram/login";
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/session", { method: "DELETE" });
  } catch {
    /* best effort */
  }
  telegramUser.set(null);
  try {
    localStorage.removeItem("wequest_user");
    localStorage.removeItem("wequest_username");
  } catch {
    /* private mode */
  }
  location.reload();
}
