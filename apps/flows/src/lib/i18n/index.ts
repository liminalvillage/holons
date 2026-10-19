// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Flows i18n: the kiosk's tiny typed message layer over en/it/es catalogs.
//
// The displayed language resolves as: the device's pin (the menu) → the device
// locale → English. Components read the reactive translator (`{$t("key")}` in
// markup) so a language switch re-renders live; imperative .ts call sites
// snapshot it with `tr()` at event time. Module-level consts must never hold a
// translated string — store `MessageKey`s and resolve where a `$t` dependency
// is visible to the compiler.

import { writable, derived, get, type Readable } from "svelte/store";
import { resolveLangMode, setResolvedLang, type LangMode } from "../config";
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

/** The device's language preference. */
export const langMode = writable<LangMode>(resolveLangMode());

/** Pure resolution: pin → device locale → English. */
export function resolveLang(mode: LangMode, deviceLocale: string): Lang {
  if (mode !== "auto") return mode;
  const nav = deviceLocale.slice(0, 2).toLowerCase();
  return nav === "it" || nav === "es" ? nav : "en";
}

/** The language the app displays right now. */
export const lang: Readable<Lang> = derived(langMode, ($m) =>
  resolveLang(
    $m,
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

/** Reactive translator: `{$t("nav.me")}` in markup re-renders on switch. */
export const t: Readable<Translator> = derived(lang, makeTranslator);

/**
 * Imperative snapshot for .ts call sites — call at event time, never to
 * initialise a module or component const.
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
