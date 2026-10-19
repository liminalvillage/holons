// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The icon set: every pictograph the app shows, as 24×24 SVG paths — the
// kiosk's own shapes, the handful this app needs. A path draws the same on
// every device where a text glyph does not. Stroked by default (1.8 units,
// round caps, `currentColor`), so an icon takes the colour and the size (1em)
// of the text it sits in; a segment marked `fill` is solid instead. Rendered
// by `Icon.svelte`. Some shapes follow Feather Icons (MIT).

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

export const ICONS = {
  close: { paths: s("M6 6l12 12", "M18 6L6 18") },
  check: { paths: s("M5 12.5l4.5 4.5L19 7") },
  plus: { paths: s("M12 5v14", "M5 12h14") },
  minus: { paths: s("M5 12h14") },
  star: {
    paths: f(
      "M12 2.8l2.8 5.9 6.4.8-4.7 4.5 1.2 6.4L12 17.3l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z",
    ),
  },
  "chevron-right": { paths: s("M9.5 6l6 6-6 6") },
  "arrow-left": { paths: s("M19 12H5", "M11.5 5.5L5 12l6.5 6.5") },
  share: {
    paths: s(
      "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8",
      "M16 6l-4-4-4 4",
      "M12 2v13",
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
  external: {
    paths: s(
      "M14 4h6v6",
      "M20 4l-9 9",
      "M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5",
    ),
  },
  link: {
    paths: s(
      "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71",
      "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
    ),
  },
  globe: {
    paths: s(
      CIRCLE,
      "M3.6 9h16.8M3.6 15h16.8",
      "M12 3c2.7 2.3 4.2 5.5 4.2 9s-1.5 6.7-4.2 9c-2.7-2.3-4.2-5.5-4.2-9s1.5-6.7 4.2-9Z",
    ),
  },
  key: {
    paths: s(
      "M15.5 3a5.5 5.5 0 1 1-3.9 9.4L5 19v2.5h3.5V19H11v-2.5h2.4A5.5 5.5 0 0 1 15.5 3Z",
      "M16.5 7.5v.01",
    ),
  },
  person: {
    paths: f(
      "M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12Zm0 2.25c-3.9 0-7.5 2-7.5 4.75V21h15v-2c0-2.75-3.6-4.75-7.5-4.75Z",
    ),
  },
  search: {
    paths: s("M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z", "M20.5 20.5L16 16"),
  },
  wallet: {
    paths: s(
      "M19 8V6a1 1 0 0 0-1-1H5.5a2.5 2.5 0 0 0 0 5H20a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5.5A2.5 2.5 0 0 1 3 17.5v-10",
      "M16.5 15h.01",
    ),
  },
  copy: {
    paths: s(
      "M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Z",
      "M16 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3",
    ),
  },
  refresh: { paths: s("M22.5 4v6h-6", "M20 15a9 9 0 1 1-2.1-9.4l4.6 4.4") },
  flow: {
    paths: s(
      "M4 5v4",
      "M4 15v4",
      "M20 9v6",
      "M4 7c8 0 8 4 16 4",
      "M4 17c8 0 8-4 16-4",
    ),
  },
  download: { paths: s("M12 4v11", "M6.5 10.5L12 16l5.5-5.5", "M5 20h14") },
  sliders: {
    paths: s(
      "M4 7h10",
      "M18 7h2",
      "M4 17h4",
      "M12 17h8",
      "M16 5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z",
      "M10 15a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z",
    ),
  },
  bank: {
    paths: s(
      "M3 10l9-6 9 6",
      "M5 10v8",
      "M9.5 10v8",
      "M14.5 10v8",
      "M19 10v8",
      "M3 20h18",
    ),
  },
  card: { paths: s("M3 6h18v12H3z", "M3 10h18", "M7 15h3") },
  send: { paths: s("M21 3L10 14", "M21 3l-7 18-4-7-7-4 18-7Z") },
  people: {
    paths: s(
      "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
      "M2.5 20a6.5 6.5 0 0 1 13 0",
      "M16 4.5a3.5 3.5 0 0 1 0 6.5",
      "M18 14.2a6.5 6.5 0 0 1 3.5 5.8",
    ),
  },
  clock: { paths: s(CIRCLE, "M12 7.5V12l3 2") },
  sun: {
    paths: s(
      "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z",
      "M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4",
    ),
  },
  moon: { paths: s("M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z") },
  gift: {
    paths: s(
      "M4 11h16v10H4z",
      "M3 7h18v4H3z",
      "M12 7v14",
      "M12 7c-1.5-3.5-6-3.5-6-1s4.5 1 6 1c1.5 0 6 1.5 6-1s-4.5-2.5-6 1",
    ),
  },
  rise: {
    paths: s(
      "M4 20h16",
      "M6 20v-6h3v6",
      "M10.5 20V9h3v11",
      "M15 20v-9h3v9",
      "M12 3l2 2.5h-4z",
    ),
  },
  trace: {
    paths: s(
      "M5 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z",
      "M19 16a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z",
      "M5 8v3a3 3 0 0 0 3 3h8a3 3 0 0 1 3 3",
    ),
  },
  sprout: {
    paths: s(
      "M12 21v-9",
      "M12 12c0-4-3-7-8-7 0 4 3 7 8 7Z",
      "M12 14c0-3.5 2.5-6 7-6 0 3.5-2.5 6-7 6Z",
    ),
  },
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;
