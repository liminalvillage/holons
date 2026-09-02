// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One colour algorithm for the whole kiosk. The post-it cards pick their colour
// by hashing a seed into the warm six-note palette (a task by its category, a
// role by its title, a shift by its code); a HOLON is coloured the very same
// way from its id — so the faint wash over its board, its orb in the dock, its
// hexagon on the map and the glow edge of every card mirrored from it all read
// as one colour. The hash and the override rule live in core
// (`pickColor` / `holonColor` in @holons/core/settings); this module supplies
// the palette and keeps the caretaker overrides this device has learned.

import { get, writable } from "svelte/store";
import {
  holonColor as resolve,
  pickColor,
  readHolonColor,
} from "@holons/core/settings";
import type { HoloSphere } from "holosphere";

/** Warm post-it palette, indexed deterministically by the card hash. */
export const NOTE_COLORS = [
  "var(--note-sun)",
  "var(--note-mint)",
  "var(--note-sky)",
  "var(--note-coral)",
  "var(--note-lav)",
  "var(--note-lime)",
] as const;

/** Stable colour for a label so the same category always gets the same note. */
export function noteColor(seed: string | undefined): string {
  return pickColor(seed, NOTE_COLORS);
}

/** holon id → caretaker override (`#rrggbb`). Absent → the hashed note. */
export type HolonColors = Record<string, string>;

/** The overrides learned this session; a dep of every colour-bearing store. */
export const holonColors = writable<HolonColors>({});

/**
 * The colour a holon is drawn with: its caretaker override, else the note its
 * id hashes to (a `var(--note-*)` reference — see `resolveCssColor` when a
 * literal is needed). Pass the store's value from a derived/reactive context
 * so a changed override re-renders; the default reads the current value for
 * one-off callers.
 */
export function holonColor(
  id: string,
  colors: HolonColors = get(holonColors),
): string {
  return resolve(id, NOTE_COLORS, colors[id]);
}

/**
 * A colour as a literal the non-CSS consumers can take (a map renderer, a
 * colour input): `var(--x)` references are resolved against the document's
 * current theme; anything else is returned as is. SSR-safe (returns the input).
 */
export function resolveCssColor(color: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(color.trim());
  if (!m || typeof document === "undefined") return color;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(m[1])
    .trim();
  return v || color;
}

/** Record (or clear) an override locally — the Settings panel does this on save. */
export function setHolonColor(id: string, color: string): void {
  holonColors.update((cur) => {
    if (color) return cur[id] === color ? cur : { ...cur, [id]: color };
    if (!(id in cur)) return cur;
    const { [id]: _, ...rest } = cur;
    return rest;
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const inFlight = new Set<string>();
const learned = new Set<string>();

/**
 * Read a holon's settings for a colour override and remember it. Best-effort
 * and de-duplicated: a partner's settings replicate shortly after we subscribe
 * to it, so a miss is retried a couple of times before giving up (an absent
 * override is the normal case — the hash then applies). A holon whose settings
 * were already read is skipped unless `fresh` asks for a re-read (the displayed
 * holon on every bind, so a colour chosen elsewhere lands on the next open).
 */
export async function learnHolonColor(
  hs: HoloSphere,
  id: string,
  opts: { fresh?: boolean } = {},
): Promise<void> {
  if (!id || inFlight.has(id)) return;
  if (learned.has(id) && !opts.fresh) return;
  inFlight.add(id);
  try {
    for (const delay of [0, 800, 2000]) {
      if (delay) await sleep(delay);
      let doc: unknown = null;
      try {
        doc = await hs.get(id, "settings", id);
      } catch {
        /* not replicated yet */
      }
      if (doc == null) continue;
      learned.add(id);
      setHolonColor(id, readHolonColor(doc));
      return;
    }
  } finally {
    inFlight.delete(id);
  }
}
