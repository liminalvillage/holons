// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Kiosk configuration. Akasha shows a single hub holon, read-only. Which holon
// and which Holosphere app namespace are resolved here, in priority order so a
// caretaker can re-point the screen without a rebuild:
//
//   holon : ?holon=<id>  →  VITE_AKASHA_HOLON  →  (unset → setup screen)
//   app   : ?app=<name>  →  VITE_HOLONS_APP    →  "Holons"
//
// The query-param overrides are persisted to localStorage so a one-time setup
// URL survives reloads and power-cycles of the entrance display.

const HOLON_KEY = "akasha_holon";
const APP_KEY = "akasha_app";

function readParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get(name);
  return v && v.trim() ? v.trim() : null;
}

function persisted(key: string): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persist(key: string, value: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — ignore, fall back to env each load */
  }
}

/** Resolve the Holosphere app namespace this kiosk connects to. */
export function resolveAppName(): string {
  const fromParam = readParam("app");
  if (fromParam) persist(APP_KEY, fromParam);
  const env = import.meta.env.VITE_HOLONS_APP as string | undefined;
  return fromParam || persisted(APP_KEY) || (env && String(env)) || "Holons";
}

/** Resolve the holon id this kiosk displays, or null if not configured. */
export function resolveHolonId(): string | null {
  const fromParam = readParam("holon");
  if (fromParam) persist(HOLON_KEY, fromParam);
  const env = import.meta.env.VITE_AKASHA_HOLON as string | undefined;
  return fromParam || persisted(HOLON_KEY) || (env ? String(env) : null);
}

/** Seconds each view is shown before the kiosk auto-advances to the next. */
export const FLIP_INTERVAL_MS = 16_000;

/** Idle grace after the last touch before auto-rotation resumes. */
export const RESUME_AFTER_IDLE_MS = 30_000;
