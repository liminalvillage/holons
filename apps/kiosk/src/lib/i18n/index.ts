// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Kiosk i18n: a tiny typed message layer over the en/it/es catalogs.
//
// The displayed language resolves as: caretaker pin (Settings) → the holon's
// own `settings.language` → the device locale → English. Components read the
// reactive translator (`{$t("key")}` in markup) so a language switch re-renders
// live; imperative .ts call sites (toasts, spoken errors) snapshot it with
// `tr()` at event time. Module-level consts must never hold a translated
// string — store `MessageKey`s and resolve where a `$t` dependency is visible
// to the compiler.
//
// NOTE: this module must not import `$lib/stores` (stores imports from here —
// a value cycle would break module init). The holon-language fallback is fed
// by `+layout.svelte`, which owns the holosphere lifecycle.

import { writable, derived, get, type Readable } from "svelte/store";
import { setResolvedLang, type LangMode } from "../config";
import type { Msg } from "./types";
import { en, type MessageKey } from "./en";
import { it } from "./it";
import { es } from "./es";

export type Lang = "en" | "it" | "es";
export type Params = Record<string, string | number>;
export type Translator = (key: MessageKey, params?: Params) => string;
export type { MessageKey, LangMode };

export const LANGS: readonly Lang[] = ["en", "it", "es"];

const CATALOGS: Record<Lang, Record<MessageKey, Msg>> = { en, it, es };

/** Caretaker device preference; hydrated from config in `+layout.svelte`. */
export const langMode = writable<LangMode>("auto");

/** The displayed holon's `settings.language`, when loaded and supported. */
export const holonLang = writable<Lang | null>(null);

/** Pure resolution: pin → holon setting → device locale → English. */
export function resolveLang(
  mode: LangMode,
  holon: Lang | null,
  deviceLocale: string,
): Lang {
  if (mode !== "auto") return mode;
  if (holon) return holon;
  const nav = deviceLocale.slice(0, 2).toLowerCase();
  return nav === "it" || nav === "es" ? nav : "en";
}

/** The language the kiosk displays right now. */
export const lang: Readable<Lang> = derived([langMode, holonLang], ([$m, $h]) =>
  resolveLang(
    $m,
    $h,
    typeof navigator !== "undefined" ? (navigator.language ?? "") : "",
  ),
);

/** BCP-47 tag for `Intl` / `toLocale*` call sites ("en" | "it" | "es"). */
export const locale: Readable<string> = lang;

/** Render one message: plural pick by `params.n`, then `{slot}` fill-in. */
export function formatMsg(msg: Msg, params?: Params): string {
  const raw =
    typeof msg === "string"
      ? msg
      : Number(params?.n) === 1
        ? msg.one
        : msg.other;
  return raw.replace(/\{(\w+)\}/g, (whole, k: string) =>
    params?.[k] != null ? String(params[k]) : whole,
  );
}

/** Pure translator factory — exported for tests; falls back to English per key. */
export function makeTranslator(l: Lang): Translator {
  const cat = CATALOGS[l];
  return (key, params) => formatMsg(cat[key] ?? en[key], params);
}

/** Reactive translator: `{$t("tabs.tasks")}` in markup re-renders on switch. */
export const t: Readable<Translator> = derived(lang, makeTranslator);

/**
 * Imperative snapshot for .ts call sites (toasts, errors) — call at event
 * time, never to initialise a module or component const.
 */
export function tr(key: MessageKey, params?: Params): string {
  return get(t)(key, params);
}

/**
 * Side effects of the resolved language: keep `<html lang>` current (screen
 * readers, hyphenation) and mirror it for the pre-hydration app.html script.
 */
export function startI18n(): () => void {
  return lang.subscribe((l) => {
    if (typeof document !== "undefined") document.documentElement.lang = l;
    setResolvedLang(l);
  });
}
