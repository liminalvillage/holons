// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The icons a gene link or an allele may carry: SEMANTIC keys, never glyphs.
// Each surface draws a key its own way — the kiosk from its SVG catalog, the
// website with Font Awesome, a text surface not at all — so a DNA reads the
// same on an iPad and on a wall display. Emoji are never stored: they are
// only as constant as the fonts of the device showing them.
//
// Icons are decoration: they stay out of `geneHash`, so changing one never
// asks anybody to acknowledge the DNA again.

export const ALLELE_ICONS = Object.freeze([
  // places and things
  'home',
  'map',
  'compass',
  'earth',
  'flag',
  'book',
  'scroll',
  'link',
  'calendar',
  'clock',
  'key',
  'lock',
  'shield',
  'food',
  'bed',
  'tools',
  'solar',
  'bolt',
  'industry',
  'chip',
  'code',
  'robot',
  'video',
  'chat',
  'mail',
  'send',
  'phone',
  // people
  'person',
  'person-check',
  'people',
  'community',
  'handshake',
  'hand',
  'care',
  'teach',
  'walk',
  'travel',
  // value
  'coins',
  'gift',
  'heart',
  'star',
  'trophy',
  'balance',
  // nature
  'seedling',
  'leaf',
  'tree',
  'water',
  'sun',
  'moon',
  'fire',
  'spa',
  // ideas and practice
  'idea',
  'eye',
  'search',
  'target',
  'network',
  'cycle',
  'lab',
  'broom',
  'pencil',
  'check',
  'info',
  'warning',
  'dna',
] as const);

export type AlleleIcon = (typeof ALLELE_ICONS)[number];

const KNOWN: ReadonlySet<string> = new Set(ALLELE_ICONS);

/** Whether `v` is one of the semantic icon keys. */
export function isAlleleIcon(v: unknown): v is AlleleIcon {
  return typeof v === 'string' && KNOWN.has(v);
}
