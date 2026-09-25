// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The kiosk's icon set: every pictograph the UI shows, as 24×24 SVG paths.
// Text glyphs (⚙ ♥ ⛓ 🔒 …) were swapped for these because a glyph is only
// as constant as the fonts on the device — an iPad hands half of them to
// Apple Color Emoji, a Linux wall display to whatever symbol font it has —
// while a path draws the same everywhere. Stroked by default (1.8 units,
// round caps, `currentColor`), so an icon takes the colour and the size
// (1em) of the text it sits in; a segment marked `fill` is solid instead.
// Rendered by `Icon.svelte`. Some shapes follow Feather Icons (MIT).

export interface IconSegment {
  d: string;
  /** Solid fill instead of a stroke. */
  fill?: boolean;
}

export interface IconDef {
  paths: IconSegment[];
}

const s = (...d: string[]): IconSegment[] => d.map((d) => ({ d }));
const f = (...d: string[]): IconSegment[] => d.map((d) => ({ d, fill: true }));

const CIRCLE = "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z";
const HEART =
  "M12 20.5s-7.3-4.4-9.2-9.2C1.5 8 3.6 4.5 7 4.5c2 0 3.6 1 5 2.7 1.4-1.7 3-2.7 5-2.7 3.4 0 5.5 3.5 4.2 6.8-1.9 4.8-9.2 9.2-9.2 9.2Z";
const STAR =
  "M12 2.8l2.8 5.9 6.4.8-4.7 4.5 1.2 6.4L12 17.3l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z";

/**
 * The lit face of the moon for one of the eight named phases (0 = new,
 * 4 = full; 1–3 waxing with the right limb lit, 5–7 waning with the left).
 * The terminator is a half-ellipse whose width follows the phase.
 */
function moonLit(k: number): string {
  if (k === 0) return "";
  if (k === 4) return CIRCLE;
  const r = 9;
  const rx = Math.abs(Math.cos((Math.PI * k) / 4)) * r;
  const waxing = k < 4;
  // Waxing: the right limb (top → bottom, clockwise) then back up along the
  // terminator, bulging right for a crescent, left for a gibbous. Waning
  // mirrors it.
  if (waxing) {
    const sweep = k < 2 ? 0 : 1;
    return `M12 3A${r} ${r} 0 0 1 12 21A${rx.toFixed(2)} ${r} 0 0 ${sweep} 12 3Z`;
  }
  const sweep = k < 6 ? 0 : 1;
  return `M12 3A${r} ${r} 0 0 0 12 21A${rx.toFixed(2)} ${r} 0 0 ${sweep} 12 3Z`;
}

function moon(k: number): IconDef {
  const lit = moonLit(k);
  return { paths: [...s(CIRCLE), ...(lit ? f(lit) : [])] };
}

export const ICONS = {
  // ── Chrome ─────────────────────────────────────────────────────────────
  gear: {
    paths: s(
      "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
      "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
    ),
  },
  close: { paths: s("M6 6l12 12", "M18 6L6 18") },
  check: { paths: s("M5 12.5l4.5 4.5L19 7") },
  plus: { paths: s("M12 5v14", "M5 12h14") },
  // "Add to Home Screen": the phone it lands on, and the two glyphs iOS
  // itself labels the steps with (the Share sheet, then the plus tile).
  smartphone: {
    paths: s(
      "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z",
      "M12 18h.01",
    ),
  },
  share: {
    paths: s(
      "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8",
      "M16 6l-4-4-4 4",
      "M12 2v13",
    ),
  },
  "plus-square": {
    paths: s(
      "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z",
      "M12 8v8",
      "M8 12h8",
    ),
  },
  info: {
    paths: [
      ...s(CIRCLE, "M12 11v5.5"),
      ...f("M12 7.2a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Z"),
    ],
  },
  warning: {
    paths: s("M12 3.5L2.5 20h19L12 3.5Z", "M12 9.5v4.5", "M12 17v.5"),
  },
  sparkles: {
    paths: f(
      "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z",
      "M19 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z",
      "M5 2.5l.7 1.8 1.8.7-1.8.7L5 7.5l-.7-1.8-1.8-.7 1.8-.7z",
    ),
  },
  party: {
    paths: s(
      "M4.5 19.5l3.8-11 7.2 7.2-11 3.8Z",
      "M10.5 6l.6-2.2",
      "M14.2 8.4l1.8-1.8",
      "M17.4 11.8l2.2-.6",
      "M16 4.5l2-1",
      "M19.5 8l1-2",
    ),
  },

  // ── Arrows & chevrons ──────────────────────────────────────────────────
  "chevron-down": { paths: s("M6 9.5l6 6 6-6") },
  "chevron-up": { paths: s("M6 14.5l6-6 6 6") },
  "chevron-right": { paths: s("M9.5 6l6 6-6 6") },
  "chevron-left": { paths: s("M14.5 6l-6 6 6 6") },
  "arrow-up": { paths: s("M12 19V5", "M5.5 11.5L12 5l6.5 6.5") },
  "arrow-down": { paths: s("M12 5v14", "M5.5 12.5L12 19l6.5-6.5") },
  "arrow-left": { paths: s("M19 12H5", "M11.5 5.5L5 12l6.5 6.5") },
  "arrow-right": { paths: s("M5 12h14", "M12.5 5.5L19 12l-6.5 6.5") },
  "arrow-up-right": { paths: s("M7 17L17 7", "M8.5 7H17v8.5") },
  swap: {
    paths: s(
      "M4 8h15",
      "M15.5 4.5L19 8l-3.5 3.5",
      "M20 16H5",
      "M8.5 12.5L5 16l3.5 3.5",
    ),
  },
  "swap-vertical": {
    paths: s(
      "M8 4.5v15",
      "M4.5 15.5L8 19l3.5-3.5",
      "M16 19.5v-15",
      "M12.5 8.5L16 5l3.5 3.5",
    ),
  },
  repeat: { paths: s("M22.5 4v6h-6", "M20 15a9 9 0 1 1-2.1-9.4l4.6 4.4") },
  undo: { paths: s("M1.5 4v6h6", "M4 15a9 9 0 1 0 2.1-9.4L1.5 10") },
  external: {
    paths: s(
      "M14 4h6v6",
      "M20 4l-9 9",
      "M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5",
    ),
  },
  expand: { paths: s("M15 3h6v6", "M9 21H3v-6", "M21 3l-7 7", "M3 21l7-7") },

  // ── Things & places ────────────────────────────────────────────────────
  pencil: { paths: s("M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z") },
  link: {
    paths: s(
      "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71",
      "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
    ),
  },
  heart: { paths: f(HEART) },
  "heart-outline": { paths: s(HEART) },
  star: { paths: f(STAR) },
  "star-outline": { paths: s(STAR) },
  badge: {
    paths: [
      ...s(CIRCLE),
      ...f(
        "M12 7.2l1.5 3 3.3.5-2.4 2.3.6 3.3-3-1.6-3 1.6.6-3.3-2.4-2.3 3.3-.5z",
      ),
    ],
  },
  crown: {
    paths: s("M4 17.5L2.5 7l5 4.2L12 4.5l4.5 6.7 5-4.2L20 17.5H4Z", "M5 21h14"),
  },
  calendar: { paths: s("M4 6.5h16v13H4z", "M4 11h16", "M8 4v4", "M16 4v4") },
  hourglass: {
    paths: s(
      "M6 3h12",
      "M6 21h12",
      "M7 3c0 5 5 6 5 9s-5 4-5 9",
      "M17 3c0 5-5 6-5 9s5 4 5 9",
    ),
  },
  box: {
    paths: s(
      "M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z",
      "M4 7.5l8 4.5 8-4.5",
      "M12 12v9",
    ),
  },
  "check-square": { paths: s("M4 4.5h15.5V20H4z", "M8 12.2l2.7 2.7L16 9.5") },
  shelf: {
    paths: s(
      "M3 4.5h18",
      "M3 12h18",
      "M3 19.5h18",
      "M7 8h4.5v4H7z",
      "M12.5 15.5H17v4h-4.5z",
    ),
  },
  target: {
    paths: [
      ...s(CIRCLE, "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"),
      ...f("M12 10.8a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Z"),
    ],
  },
  tray: {
    paths: s("M4 12l2.5-7h11L20 12v7.5H4z", "M4 12h4.5l1.5 2.5h4L15.5 12H20"),
  },
  cart: {
    paths: [
      ...s("M2.5 4h2.5l2.4 11h10.4L21 7.5H6.5"),
      ...f(
        "M9.5 18a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Z",
        "M17 18a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Z",
      ),
    ],
  },
  scales: {
    paths: s(
      "M12 3.5v17.5",
      "M6 21h12",
      "M12 6.5L4.5 9",
      "M12 6.5l7.5 2.5",
      "M2 15.5l2.5-6.5 2.5 6.5a2.5 2.5 0 0 1-5 0Z",
      "M17 15.5l2.5-6.5 2.5 6.5a2.5 2.5 0 0 1-5 0Z",
    ),
  },
  home: {
    paths: s("M3.5 11L12 3.5l8.5 7.5", "M5.5 10v10.5h13V10", "M10 20.5v-6h4v6"),
  },
  globe: {
    paths: s(
      CIRCLE,
      "M3.6 9h16.8M3.6 15h16.8",
      "M12 3c2.7 2.3 4.2 5.5 4.2 9s-1.5 6.7-4.2 9c-2.7-2.3-4.2-5.5-4.2-9s1.5-6.7 4.2-9Z",
    ),
  },
  hexagon: { paths: s("M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z") },
  pin: {
    paths: s(
      "M12 21s-7-6.3-7-11.5a7 7 0 0 1 14 0C19 14.7 12 21 12 21Z",
      "M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
    ),
  },
  locate: {
    paths: [
      ...s(
        "M12 5a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z",
        "M12 1.5V5",
        "M12 19v3.5",
        "M1.5 12H5",
        "M19 12h3.5",
      ),
      ...f("M12 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"),
    ],
  },
  disc: {
    paths: [...s(CIRCLE), ...f("M12 7.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z")],
  },
  lock: { paths: s("M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4") },
  unlock: { paths: s("M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 7.6-1.7") },
  key: {
    paths: s(
      "M15.5 3a5.5 5.5 0 1 1-3.9 9.4L5 19v2.5h3.5V19H11v-2.5h2.4A5.5 5.5 0 0 1 15.5 3Z",
      "M16.5 7.5v.01",
    ),
  },
  power: { paths: s("M18.4 6.6a9 9 0 1 1-12.8 0", "M12 2.5v9.5") },
  trash: {
    paths: s(
      "M3.5 6h17",
      "M8.5 6V3.5h7V6",
      "M6 6l1 15h10l1-15",
      "M10 10.5v6.5",
      "M14 10.5v6.5",
    ),
  },
  bulb: {
    paths: s(
      "M9 18h6",
      "M10 21h4",
      "M12 2.5a6.5 6.5 0 0 0-3.7 11.8c.8.6 1.2 1.3 1.2 2.2V18h5v-1.5c0-.9.4-1.6 1.2-2.2A6.5 6.5 0 0 0 12 2.5Z",
    ),
  },
  users: {
    paths: s(
      "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
      "M2.5 21v-1a6 6 0 0 1 6-6h1a6 6 0 0 1 6 6v1",
      "M16 3.3a4 4 0 0 1 0 7.4",
      "M21.5 21v-1a6 6 0 0 0-4-5.6",
    ),
  },
  person: {
    paths: f(
      "M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12Zm0 2.25c-3.9 0-7.5 2-7.5 4.75V21h15v-2c0-2.75-3.6-4.75-7.5-4.75Z",
    ),
  },
  "user-circle": {
    paths: s(
      CIRCLE,
      "M12 12.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
      "M5.8 18.8c1.4-2.3 3.6-3.5 6.2-3.5s4.8 1.2 6.2 3.5",
    ),
  },
  hand: {
    paths: s(
      "M18 11V6.5a1.8 1.8 0 0 0-3.6 0V11",
      "M14.4 10.5V4.3a1.8 1.8 0 0 0-3.6 0v6.2",
      "M10.8 11V6a1.8 1.8 0 0 0-3.6 0v8",
      "M18 8.5a1.8 1.8 0 0 1 3.6 0V14a7.5 7.5 0 0 1-7.5 7.5h-1.6c-2.6 0-4.2-1.3-5.6-3.3L3.7 14.4a1.9 1.9 0 0 1 3-2.3L7.2 13",
    ),
  },
  trophy: {
    paths: s(
      "M8 21h8",
      "M12 17v4",
      "M7 3.5h10V9a5 5 0 0 1-10 0z",
      "M7 5.5H4a3 3 0 0 0 3 3.5",
      "M17 5.5h3a3 3 0 0 1-3 3.5",
    ),
  },
  medal: {
    paths: s(
      "M12 10a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z",
      "M8.3 11L5.5 2.5H10l2 4.5 2-4.5h4.5L15.7 11",
    ),
  },
  keyboard: {
    paths: s(
      "M3 6.5h18v11H3z",
      "M6.5 10h.5",
      "M10.5 10h.5",
      "M14.5 10h.5",
      "M18 10h-.5",
      "M7.5 14h9",
    ),
  },

  // ── Layouts (the pills) ────────────────────────────────────────────────
  card: { paths: s("M5.5 3.5h13v17h-13z") },
  list: { paths: s("M4 7h16", "M4 12h16", "M4 17h16") },
  grid: { paths: s("M4 4h16v16H4z", "M4 12h16", "M12 4v16") },
  rows: { paths: s("M4 4h16v16H4z", "M4 9.3h16", "M4 14.7h16") },
  day: {
    paths: [...s("M4 4h16v16H4z"), ...f("M12 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z")],
  },
  graph: {
    paths: s(
      "M6 4.5a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8Z",
      "M18 4.5a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8Z",
      "M12 15.7a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8Z",
      "M7 8l4 7.5",
      "M17 8l-4 7.5",
    ),
  },
  clock: { paths: s(CIRCLE, "M12 7v5l3 2") },
  grip: {
    paths: f(
      "M9 4a1.6 1.6 0 1 1 0 3.2A1.6 1.6 0 0 1 9 4Z",
      "M15 4a1.6 1.6 0 1 1 0 3.2A1.6 1.6 0 0 1 15 4Z",
      "M9 10.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2Z",
      "M15 10.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2Z",
      "M9 16.8a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2Z",
      "M15 16.8a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2Z",
    ),
  },
  filter: { paths: s("M4 5h16l-6 7v5l-4 2v-7L4 5Z") },
  eye: {
    paths: s(
      "M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z",
      "M12 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Z",
    ),
  },
  sort: {
    paths: s(
      "M4 6h12",
      "M4 12h9",
      "M4 18h6",
      "M19 7v10",
      "M16.5 14.5 19 17l2.5-2.5",
    ),
  },

  // ── Sky ────────────────────────────────────────────────────────────────
  sun: {
    paths: s(
      "M12 7.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z",
      "M12 2v2.2",
      "M12 19.8V22",
      "M2 12h2.2",
      "M19.8 12H22",
      "M4.9 4.9l1.6 1.6",
      "M17.5 17.5l1.6 1.6",
      "M4.9 19.1l1.6-1.6",
      "M17.5 6.5l1.6-1.6",
    ),
  },
  moon: { paths: s("M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z") },
  contrast: { paths: [...s(CIRCLE), ...f("M12 3a9 9 0 0 1 0 18z")] },
  moon0: moon(0),
  moon1: moon(1),
  moon2: moon(2),
  moon3: moon(3),
  moon4: moon(4),
  moon5: moon(5),
  moon6: moon(6),
  moon7: moon(7),
} as const satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

/** The eight named moon faces in phase order (new → full → new). */
export const MOON_ICONS: IconName[] = [
  "moon0",
  "moon1",
  "moon2",
  "moon3",
  "moon4",
  "moon5",
  "moon6",
  "moon7",
];

export function isIconName(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}
