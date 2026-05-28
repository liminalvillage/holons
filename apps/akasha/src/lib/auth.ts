// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Telegram identity for the kiosk. Editing is gated behind being "logged in
// with Telegram"; viewing is always open. Identity is resolved, in order:
//   1. inside a Telegram WebApp  → window.Telegram.WebApp.initDataUnsafe.user
//   2. dev env fallback          → VITE_DEV_TELEGRAM_USER_* (non-prod only)
//   3. persisted login           → localStorage (set by the Login Widget)
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
  auth_date?: number;
  hash?: string;
}

const STORAGE_KEY = "akasha_telegram_user";

export const telegramUser = writable<TelegramUser | null>(null);
export const isLoggedIn = derived(telegramUser, (u) => u != null);

/** Whether a login overlay is currently requested. */
export const loginOpen = writable<boolean>(false);

/** The configured Login Widget bot username (without @), if any. */
export const botUsername = (import.meta.env.VITE_TELEGRAM_BOT_USERNAME ?? "")
  .toString()
  .replace(/^@/, "");

function persisted(): TelegramUser | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TelegramUser) : null;
  } catch {
    return null;
  }
}

function devUser(): TelegramUser | null {
  if (import.meta.env.PROD) return null;
  const id = Number(import.meta.env.VITE_DEV_TELEGRAM_USER_ID);
  const name = import.meta.env.VITE_DEV_TELEGRAM_USER_NAME;
  if (!Number.isFinite(id) || !name) return null;
  const u: TelegramUser = { id, first_name: String(name) };
  const username = import.meta.env.VITE_DEV_TELEGRAM_USER_USERNAME;
  if (username) u.username = String(username);
  return u;
}

/** Resolve and hydrate the current Telegram identity. Call once on mount. */
export function initAuth(): void {
  if (typeof window === "undefined") return;
  const wa = (window as any).Telegram?.WebApp;
  if (wa?.initDataUnsafe?.user) {
    wa.ready?.();
    wa.expand?.();
    setUser(wa.initDataUnsafe.user as TelegramUser);
    return;
  }
  const dev = devUser();
  if (dev) {
    setUser(dev);
    return;
  }
  const stored = persisted();
  if (stored) telegramUser.set(stored);
}

/** Record a logged-in user (from the Login Widget or WebApp) and persist it. */
export function setUser(user: TelegramUser): void {
  telegramUser.set(user);
  loginOpen.set(false);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch {
    /* private mode — session-only login */
  }
}

export function logout(): void {
  telegramUser.set(null);
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
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
