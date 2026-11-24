// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One colour per unit on the Flows board, computed from the unit's NAME —
// so USD is the same colour on every board, in every chart and chip,
// whatever else is on show and in whatever order it arrives. The Sankey's
// lanes, its legend and the unit chips above it all read this.
//
// Well-known currencies and units have a fixed colour each, chosen to sit
// apart. Any other name is hashed onto one of twelve hues kept clear of
// those, at one of two lightnesses. The hash's salt is fixed (never change
// it: every colour on every board would move) and was picked so the units
// boards commonly carry — tree, cooking, l, pack, kg, lends, evo, oil — land
// on eight different hues.

const KNOWN: Record<string, string> = {
  usd: "hsl(145 60% 36%)",
  eur: "hsl(220 70% 50%)",
  euro: "hsl(220 70% 50%)",
  gbp: "hsl(270 55% 52%)",
  chf: "hsl(0 65% 50%)",
  btc: "hsl(33 90% 48%)",
  sats: "hsl(33 90% 48%)",
  hour: "hsl(195 75% 40%)",
  hours: "hsl(195 75% 40%)",
  kudos: "hsl(330 65% 52%)",
  credit: "hsl(85 55% 38%)",
  credits: "hsl(85 55% 38%)",
};
const HUES = [15, 50, 65, 110, 125, 165, 240, 255, 290, 305, 350, 180];
const LIGHTNESS = [38, 52];
const SALT = 2055;

/** FNV-1a with a murmur finalizer: small, stable, well spread. */
function hash(s: string): number {
  let h = (0x811c9dc5 ^ SALT) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The colour of a unit, by name; case and surrounding space ignored. */
export function unitHue(unit: string): string {
  const key = unit.trim().toLowerCase();
  if (KNOWN[key]) return KNOWN[key];
  const h = hash(key);
  const hue = HUES[h % HUES.length];
  const light = LIGHTNESS[Math.floor(h / HUES.length) % LIGHTNESS.length];
  return `hsl(${hue} 62% ${light}%)`;
}

/** `units` → their colours (same as `unitHue` each, one entry per name). */
export function unitHueMap(units: readonly string[]): Map<string, string> {
  return new Map(units.map((u) => [u, unitHue(u)] as const));
}
