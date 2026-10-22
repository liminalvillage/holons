// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Formatting shared by every Flows panel, so a number reads the same on the
// Sankey, in a balance row and in the ledger. Nothing here decides a value —
// core does that; this only decides how it is written.

import type { ValueFlowTrack } from "@holons/core/flows";

export type Formatter = (value: number) => string;

export function trackKey(track: Pick<ValueFlowTrack, "id" | "unit">): string {
  return `${track.id}:${track.unit}`;
}

export function trackLabel(track: Pick<ValueFlowTrack, "id" | "unit">): string {
  if (track.id === "time") return "Hours";
  if (track.id === "appreciation") return "Kudos";
  return currencyLabel(track.unit);
}

/** A currency code as a pill reads it. */
export function currencyLabel(unit: string): string {
  if (unit === "credit" || unit === "credits") return "Credits";
  return unit.toUpperCase();
}

const cache = new Map<string, Formatter>();

/**
 * Format a value in its track's unit. Real ISO codes get locale currency
 * formatting; a holon's own scrip falls back to a plain number plus the unit.
 * `fraction` sets the decimals — the Sankey rounds to whole units, a balance
 * needs its cents.
 */
export function formatter(
  track: Pick<ValueFlowTrack, "id" | "unit"> | null,
  fraction = 0,
): Formatter {
  if (!track) return (v) => String(Math.round(v));
  const key = `${track.id}:${track.unit}:${fraction}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let fmt: Formatter | null = null;
  const code = track.unit.toUpperCase();
  if (track.id === "money" && /^[A-Z]{3}$/.test(code)) {
    try {
      const nf = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: code,
        minimumFractionDigits: fraction,
        maximumFractionDigits: fraction,
      });
      fmt = (v) => nf.format(v);
    } catch {
      // Not a currency Intl knows; fall through rather than throwing.
    }
  }
  if (!fmt) {
    const nf = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: fraction,
      maximumFractionDigits: Math.max(fraction, 1),
    });
    const unit =
      track.id === "time"
        ? "h"
        : track.id === "appreciation"
          ? "kudos"
          : track.unit;
    fmt = (v) => `${nf.format(v)} ${unit}`;
  }
  cache.set(key, fmt);
  return fmt;
}

/** Money in `currency`, cents included. */
export function moneyFormatter(currency: string): Formatter {
  return formatter({ id: "money", unit: currency }, 2);
}

export const dateFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});
export const stampFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/** "Today", "Yesterday", or the date — the way a phone lists things. */
export function relativeDay(ts: number, now = Date.now()): string {
  const day = 24 * 60 * 60 * 1000;
  const start = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const diff = Math.round((start(now) - start(ts)) / day);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return dateFmt.format(ts);
}

/** First letter of a name, for an avatar fallback. */
export function initial(name: string): string {
  return (name.trim()[0] || "?").toUpperCase();
}
