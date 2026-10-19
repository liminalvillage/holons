// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Flows configuration — which Pot, which Holosphere namespace, which relays,
// and the device's own preferences. Resolution order (mirrors wequest):
//
//   pot : ?pot=<holon>  →  localStorage  →  VITE_FLOWS_POT  →  "" (nothing to show)
//   app : ?app=<name>   →  localStorage  →  VITE_FLOWS_APP  →  "HolonsDebug"
//         in dev / "Holons" in production builds
//
// Query-param overrides persist to localStorage so a one-time setup URL
// survives reloads.

import {
  resolveEnforce,
  resolveRelays as coreResolveRelays,
} from "@holons/core/holosphere";

const POT_KEY = "flows_pot";
const APP_KEY = "flows_app";
const THEME_KEY = "flows_theme";
const LANG_KEY = "flows_lang";
const LANG_RESOLVED_KEY = "flows_lang_resolved";

function persisted(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — the choice lasts this visit */
  }
}

function forget(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}

function fromQueryOrStorage(param: string, storageKey: string): string {
  if (typeof window === "undefined") return "";
  try {
    const q = new URLSearchParams(window.location.search).get(param);
    if (q && q.trim()) {
      persist(storageKey, q.trim());
      return q.trim();
    }
  } catch {
    /* no URL to read */
  }
  return persisted(storageKey);
}

export function resolveAppName(): string {
  return (
    fromQueryOrStorage("app", APP_KEY) ||
    import.meta.env.VITE_FLOWS_APP ||
    // An unconfigured DEV run must not write to the production graph.
    (import.meta.env.DEV ? "HolonsDebug" : "Holons")
  );
}

/** The Pot holon whose flows this deployment shows. */
export function resolvePot(): string {
  return (
    fromQueryOrStorage("pot", POT_KEY) || import.meta.env.VITE_FLOWS_POT || ""
  );
}

/** Relay URLs — the wire. `VITE_FLOWS_RELAYS`, else the shared
 *  `VITE_HOLOSPHERE_RELAYS`, else the production relay set. */
export function resolveRelays(): string[] {
  return coreResolveRelays(
    import.meta.env.VITE_FLOWS_RELAYS ||
      import.meta.env.VITE_HOLOSPHERE_RELAYS ||
      "",
  );
}

/** Authorized reads: on unless VITE_HOLOSPHERE_ENFORCE says `off`. */
export function resolveEnforceReads(): boolean {
  return resolveEnforce(
    import.meta.env.VITE_HOLOSPHERE_ENFORCE as string | undefined,
  );
}

/**
 * Dev only: a flow graph to draw instead of the published snapshot
 * (`?graph=/some.json`, a `FlowGraph` as `--out` of the publish script saves
 * it). Never read in a production build.
 */
export function resolveDevGraphUrl(): string {
  if (!import.meta.env.DEV || typeof window === "undefined") return "";
  try {
    return new URLSearchParams(window.location.search).get("graph") ?? "";
  } catch {
    return "";
  }
}

/** How the day/night palette is chosen. `auto` follows the device. */
export type ThemeMode = "auto" | "light" | "dark";

export function resolveThemeMode(): ThemeMode {
  const v = persisted(THEME_KEY);
  return v === "light" || v === "dark" ? v : "auto";
}

export function setThemeMode(mode: ThemeMode): void {
  if (mode === "auto") forget(THEME_KEY);
  else persist(THEME_KEY, mode);
}

export type LangMode = "auto" | "en" | "it" | "es";

export function resolveLangMode(): LangMode {
  const v = persisted(LANG_KEY);
  return v === "en" || v === "it" || v === "es" ? v : "auto";
}

export function setLangMode(mode: LangMode): void {
  if (mode === "auto") forget(LANG_KEY);
  else persist(LANG_KEY, mode);
}

/** Mirror of the last resolved language, read by app.html before hydration. */
export function setResolvedLang(l: "en" | "it" | "es"): void {
  persist(LANG_RESOLVED_KEY, l);
}

/** Below this width the diagrams draw one column of provenance, not two. */
export const NARROW_PX = 480;
