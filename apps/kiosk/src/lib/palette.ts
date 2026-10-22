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

/** WCAG relative luminance of a literal `#rrggbb`; `undefined` otherwise. */
export function luminance(color: string | undefined): number | undefined {
  const m = /^#([0-9a-f]{6})$/i.exec(color?.trim() ?? "");
  if (!m) return undefined;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two luminances (1 = none, 21 = black on white). */
function ratio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The inks `inkOn` picks from, in order of preference: white, the board's own
 * dark ink, and — for the mid-tones (a rose, an amber) that leave neither of
 * those 4.5:1 — black, which together with white covers every ground.
 */
const INKS: readonly (readonly [string, number])[] = [
  ["#ffffff", 1],
  ["#20302f", 0.027],
  ["#000000", 0],
];

/**
 * The ink that reads on a literal `#rrggbb` background: the first of white,
 * the board's dark ink and black to clear WCAG AA against it. `undefined` for
 * anything else (a `var(--note-*)` reference is theme-tuned already and keeps
 * the default ink).
 */
export function inkOn(color: string | undefined): string | undefined {
  const lum = luminance(color);
  if (lum === undefined) return undefined;
  return (INKS.find(([, ink]) => ratio(lum, ink) >= 4.5) ?? INKS[2])[0];
}

/** Parse a literal `#rrggbb` into its channels; `undefined` otherwise. */
function channels(color: string | undefined): number[] | undefined {
  const m = /^#([0-9a-f]{6})$/i.exec(color?.trim() ?? "");
  return m
    ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16))
    : undefined;
}

const toHex = (rgb: number[]) =>
  "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/**
 * A chosen colour as TEXT: `color` moved toward black or white — whichever
 * way the grounds call for — only as far as it takes to reach `min` contrast
 * against every one of them, so the hue survives and a colour that already
 * reads is returned untouched. This is what lets a caretaker's accent be used
 * as ink on both the day paper and the night slate. `undefined` unless every
 * colour is a literal `#rrggbb`.
 */
export function readableOn(
  color: string | undefined,
  grounds: readonly string[],
  min = 4.5,
): string | undefined {
  const rgb = channels(color);
  const lums = grounds.map(luminance);
  if (!rgb || !lums.length || lums.some((l) => l === undefined))
    return undefined;
  const ground = lums as number[];
  // Dark grounds want a lighter ink, light grounds a darker one.
  const pole =
    ground.reduce((a, b) => a + b, 0) / ground.length < 0.2 ? 255 : 0;
  for (let step = 0; step <= 50; step++) {
    const t = step / 50;
    const mixed = toHex(rgb.map((c) => c + (pole - c) * t));
    const lum = luminance(mixed) as number;
    if (ground.every((g) => ratio(lum, g) >= min)) return mixed;
  }
  return pole ? "#ffffff" : "#000000";
}

/**
 * A holon's colour as a GROUND to wash a surface with. The note palette is
 * already tuned per theme (pastels by day, jewels by night); a caretaker's
 * literal colour is not, and a deep one washed over the day paper — or a pale
 * one over the night slate — takes the ink's contrast with it. So a literal
 * is drawn into the range the notes themselves keep: no darker than the
 * deepest pastel by day, no lighter than the brightest jewel by night. The
 * hue survives; anything else is returned as is.
 */
export function washOf(color: string, theme: "light" | "dark"): string {
  const rgb = channels(color);
  if (!rgb) return color;
  const pole = theme === "dark" ? 0 : 255;
  const fits = (lum: number) => (theme === "dark" ? lum <= 0.075 : lum >= 0.66);
  for (let step = 0; step <= 50; step++) {
    const mixed = toHex(rgb.map((c) => c + (pole - c) * (step / 50)));
    if (fits(luminance(mixed) as number)) return mixed;
  }
  return pole ? "#ffffff" : "#000000";
}

/** Everything accent-coloured text sits on, in whichever palette is up: the
 *  surfaces, and the post-its (an "available" chip, a "needs 2" caption). */
const ACCENT_GROUNDS = [
  "--card",
  "--paper",
  "--paper-deep",
  "--line",
  "--note-sun",
  "--note-mint",
  "--note-sky",
  "--note-coral",
  "--note-lav",
  "--note-lime",
];

/**
 * The accent family the layout sets on :root, from the caretaker's colour and
 * the palette on screen (read off the document, so call it AFTER the theme
 * attribute has flipped):
 *  - `deep`  — a shade darker, for pressed grounds and rims;
 *  - `ink`   — the accent as TEXT on the theme's surfaces and notes: the deep
 *              shade by day, the accent lifted toward white by night (see
 *              readableOn);
 *  - `on`    — the ink that reads ON an accent ground.
 * `ink`/`on` are `undefined` for a non-literal accent; app.css carries the
 * fallbacks.
 */
export function accentFamily(
  accent: string,
  theme: "light" | "dark",
): { deep: string; ink?: string; on?: string } {
  const rgb = channels(accent);
  const deep = rgb
    ? toHex(rgb.map((c) => c * 0.78))
    : `color-mix(in srgb, ${accent} 78%, #000)`;
  const grounds = ACCENT_GROUNDS.map((v) => resolveCssColor(`var(${v})`));
  return {
    deep,
    ink: readableOn(theme === "dark" ? accent : deep, grounds),
    on: inkOn(accent),
  };
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
