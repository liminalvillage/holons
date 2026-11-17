// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// How numbers and ages are written. Pure: the translated words around them
// are the caller's.

/**
 * A failure as the reader sees it: the translated line, then the reason core
 * gave ("That project is already claimed"), so it is never just "it failed".
 */
export function failure(base: string, err: unknown): string {
  const why = String((err as Error)?.message ?? "").trim();
  return why && why !== base
    ? `${base} ${why}${/[.!?]$/.test(why) ? "" : "."}`
    : base;
}

/** A percent as text: never "0%" for something that is there. */
export function pct(value: number, locale = "en"): string {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  const mark = decimalMark(locale);
  const local = (text: string) =>
    mark === "." ? text : text.replace(".", mark);
  if (value < 0.01) return local("<0.01%");
  if (value < 10) return local(`${trim(value.toFixed(2))}%`);
  if (value < 99.95) return local(`${trim(value.toFixed(1))}%`);
  return "100%";
}

/** The decimal mark the reader's locale writes ("," in it/es). */
function decimalMark(locale: string): string {
  try {
    return (
      new Intl.NumberFormat(locale)
        .formatToParts(1.5)
        .find((p) => p.type === "decimal")?.value ?? "."
    );
  } catch {
    return ".";
  }
}

const trim = (text: string) => text.replace(/\.?0+$/, "");

/** An amount with its unit, grouped for the reader's locale. */
export function amount(value: number, unit: string, locale = "en"): string {
  const n = Number.isFinite(value) ? value : 0;
  const digits = Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 1 ? 2 : 4;
  let text: string;
  try {
    text = new Intl.NumberFormat(locale, {
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    text = String(Math.round(n * 10 ** digits) / 10 ** digits);
  }
  return unit ? `${text} ${unit}` : text;
}

/** A bar or ribbon's value: an amount on a track that has a unit, else a percent. */
export function valueText(value: number, unit: string, locale = "en"): string {
  return unit ? amount(value, unit, locale) : pct(value);
}

export type Age =
  | { key: "age.now" }
  | { key: "age.minutes" | "age.hours" | "age.days"; n: number };

/** How long ago `at` was, as a message key and its count. */
export function ageOf(at: number, now: number): Age {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 2) return { key: "age.now" };
  if (minutes < 60) return { key: "age.minutes", n: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return { key: "age.hours", n: hours };
  return { key: "age.days", n: Math.floor(hours / 24) };
}

/** A snapshot is cut once a lunation; past this it has missed one. */
export const STALE_AFTER_DAYS = 35;

export function isStale(at: number, now: number): boolean {
  return now - at > STALE_AFTER_DAYS * 86_400_000;
}

/** `0x1234…abcd`. */
export function shortAddress(address: string): string {
  const a = String(address ?? "");
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** A label cut to `max` characters, the cut marked. */
export function clip(text: string, max: number): string {
  const s = String(text ?? "");
  if (max <= 1) return s.length > 1 ? "…" : s;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
