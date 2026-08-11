// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// WeQuest configuration — which holon, which Holosphere namespace, and who is
// acting. Resolution order (mirrors the kiosk):
//
//   holon : ?holon=<id>  →  localStorage  →  VITE_WEQUEST_HOLON  →  "" (setup)
//   app   : ?app=<name>  →  localStorage  →  VITE_WEQUEST_APP    →  "HolonsDebug"
//           in dev / "Holons" in production builds
//   user  : ?user=<id>   →  localStorage  →  "" (guest, read-only feel)
//
// Query-param overrides persist to localStorage so a one-time setup URL
// survives reloads.

/** Production Gun relay read by default. */
export const PRODUCTION_PEER = "https://gun.holons.io/gun";

const HOLON_KEY = "wequest_holon";
const APP_KEY = "wequest_app";
const USER_KEY = "wequest_user";
const USERNAME_KEY = "wequest_username";

function fromQueryOrStorage(param: string, storageKey: string): string {
  if (typeof window === "undefined") return "";
  try {
    const q = new URLSearchParams(window.location.search).get(param);
    if (q && q.trim()) {
      localStorage.setItem(storageKey, q.trim());
      return q.trim();
    }
    return localStorage.getItem(storageKey) ?? "";
  } catch {
    return "";
  }
}

export function resolveAppName(): string {
  return (
    fromQueryOrStorage("app", APP_KEY) ||
    import.meta.env.VITE_WEQUEST_APP ||
    // Unconfigured DEV runs must not write to the production graph — mirror
    // the bot's MODE=development convention and land in the Debug namespace.
    // Production builds keep the live namespace.
    (import.meta.env.DEV ? "HolonsDebug" : "Holons")
  );
}

export function resolveHolon(): string {
  return (
    fromQueryOrStorage("holon", HOLON_KEY) ||
    import.meta.env.VITE_WEQUEST_HOLON ||
    ""
  );
}

export function resolvePeers(): string[] {
  const peer = import.meta.env.VITE_WEQUEST_PEER || PRODUCTION_PEER;
  return [peer];
}

export function resolveUserId(): string {
  return fromQueryOrStorage("user", USER_KEY);
}

export function resolveUsername(): string {
  return fromQueryOrStorage("username", USERNAME_KEY) || resolveUserId();
}

export function setHolon(id: string): void {
  try {
    localStorage.setItem(HOLON_KEY, id.trim());
  } catch {
    /* private mode */
  }
}

export function setUser(id: string, username?: string): void {
  try {
    localStorage.setItem(USER_KEY, id.trim());
    if (username) localStorage.setItem(USERNAME_KEY, username.trim());
  } catch {
    /* private mode */
  }
}

/** Two-letter monogram for avatars ("roberto" → "RO", "Anna B" → "AB"). */
export function initials(name: string): string {
  const parts = String(name || "??")
    .trim()
    .split(/\s+/);
  const two =
    parts.length > 1 ? parts[0][0] + parts[1][0] : String(parts[0]).slice(0, 2);
  return two.toUpperCase();
}
