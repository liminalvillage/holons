// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Kiosk configuration. The kiosk shows a single hub holon (read-only until a
// Telegram login). Which holon and which Holosphere app namespace are resolved
// here, in priority order so a caretaker can re-point the screen without a
// rebuild — or from the in-app Settings panel, which writes the same keys:
//
//   holon : ?holon=<id>  →  subdomain map (holons.ts)  →  Settings / localStorage  →  VITE_KIOSK_HOLON  →  (unset → setup)
//   app   : ?app=<name>  →  Settings / localStorage  →  VITE_KIOSK_APP    →  "Holons"
//
// The kiosk reads PRODUCTION by default: the app namespace falls back to
// "Holons" (not the shared dev `VITE_HOLONS_APP`, which the web/bot point at
// HolonsDebug), and the Gun peer falls back to the production relay. Override
// only via the kiosk-specific `VITE_KIOSK_APP` / `VITE_KIOSK_PEER`.
//
// The query-param overrides are persisted to localStorage so a one-time setup
// URL survives reloads and power-cycles of the entrance display.

import { holonForHost } from "./holons";

/** Production Gun relay the entrance display reads from by default. */
export const PRODUCTION_PEER = "https://gun.holons.io/gun";

const HOLON_KEY = "kiosk_holon";
const APP_KEY = "kiosk_app";
const FEDERATED_KEY = "kiosk_federated";
const BRAND_NAME_KEY = "kiosk_brand_name";
const BRAND_LOGO_KEY = "kiosk_brand_logo";
const ACCENT_KEY = "kiosk_accent";

/** The kiosk's default accent (teal). */
export const DEFAULT_ACCENT = "#0e6b66";

/** Base URL of the full web dashboard the "holon" header button opens. */
export const DASHBOARD_BASE = "https://dashboard.holons.io";

/** Link to a holon's full dashboard, e.g. https://dashboard.holons.io/<id>. */
export function dashboardUrl(holonId: string): string {
  return `${DASHBOARD_BASE}/${encodeURIComponent(holonId)}`;
}

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

function forget(key: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Resolve the Holosphere app namespace this kiosk connects to. */
export function resolveAppName(): string {
  const fromParam = readParam("app");
  if (fromParam) persist(APP_KEY, fromParam);
  const env = import.meta.env.VITE_KIOSK_APP as string | undefined;
  return fromParam || persisted(APP_KEY) || (env && String(env)) || "Holons";
}

/** Gun peer(s) the kiosk reads from — the production relay unless overridden. */
export function resolvePeers(): string[] {
  const env = import.meta.env.VITE_KIOSK_PEER as string | undefined;
  const peer = (env && String(env).trim()) || PRODUCTION_PEER;
  return [peer];
}

/** Resolve the holon id this kiosk displays, or null if not configured. */
export function resolveHolonId(): string | null {
  const fromParam = readParam("holon");
  if (fromParam) persist(HOLON_KEY, fromParam);
  // A registered subdomain (liminal.hubs.network → liminal) is authoritative
  // for that host — one deploy serves every holon. `?holon=` still overrides.
  const fromSubdomain =
    typeof window !== "undefined"
      ? holonForHost(window.location.hostname)
      : null;
  const env = import.meta.env.VITE_KIOSK_HOLON as string | undefined;
  return (
    fromParam ||
    fromSubdomain ||
    persisted(HOLON_KEY) ||
    (env ? String(env) : null)
  );
}

/** Persist the holon id chosen from the in-app Settings panel. */
export function setHolonId(id: string): void {
  persist(HOLON_KEY, id.trim());
}

/** Whether the kiosk aggregates this holon's federation partners. */
export function resolveFederated(): boolean {
  return persisted(FEDERATED_KEY) === "1";
}

/** Persist the federated-view toggle. */
export function setFederated(on: boolean): void {
  persist(FEDERATED_KEY, on ? "1" : "0");
}

/**
 * The kiosk's display name, shown in the header beside the logo. A caretaker can
 * override the holon's own name here; null means "use the holon's name".
 */
export function resolveBrandName(): string | null {
  return persisted(BRAND_NAME_KEY);
}

/** Persist (or clear, when blank) the custom display name. */
export function setBrandName(name: string): void {
  const trimmed = name.trim();
  if (trimmed) persist(BRAND_NAME_KEY, trimmed);
  else forget(BRAND_NAME_KEY);
}

/**
 * A custom logo for the header, stored as a data URL (uploaded image) or any
 * image URL. null means "use the bundled kiosk logo".
 */
export function resolveBrandLogo(): string | null {
  return persisted(BRAND_LOGO_KEY);
}

/** Persist (or clear, when null/blank) the custom header logo. */
export function setBrandLogo(value: string | null): void {
  if (value && value.trim()) persist(BRAND_LOGO_KEY, value);
  else forget(BRAND_LOGO_KEY);
}

/** The accent colour (hex), used for the teal-derived UI. Defaults to teal. */
export function resolveAccent(): string {
  return persisted(ACCENT_KEY) || DEFAULT_ACCENT;
}

/** Persist (or reset to default, when blank) the accent colour. */
export function setAccent(value: string | null): void {
  if (value && value.trim() && value.trim() !== DEFAULT_ACCENT) {
    persist(ACCENT_KEY, value.trim());
  } else {
    forget(ACCENT_KEY);
  }
}

/** Seconds each view is shown before the kiosk auto-advances to the next. */
export const FLIP_INTERVAL_MS = 16_000;

/** Idle grace after the last touch before auto-rotation resumes. */
export const RESUME_AFTER_IDLE_MS = 30_000;
