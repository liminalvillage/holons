// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shared segment vocabulary for the PillSwitch controls, so every view's
// pills speak the same visual language: one card at a time is a "Card" (❏),
// rows are a "List" (☰), a grid of items is a "Wall" (▦), the roles week
// grid is "Week" (▤). Each view spreads these over its own persisted mode
// ids (which predate the shared naming and must not change — they're stored
// per device). Labels are catalog keys — resolved with `$t` where they
// render, so a language switch re-labels the pills live.

import type { MessageKey } from "./i18n";

/** Layout segment looks, keyed by what the layout *is*, not per-view names. */
export const LAYOUT_SEGMENTS = {
  card: { glyph: "❏", labelKey: "pills.card" },
  list: { glyph: "☰", labelKey: "pills.list" },
  wall: { glyph: "▦", labelKey: "pills.wall" },
  week: { glyph: "▤", labelKey: "pills.week" },
  graph: { glyph: "⌥", labelKey: "pills.graph" },
  // The dated board: the same items laid out over time. Its own hatch, since
  // the plain grid (▦) is already the wall and the rows (▤) the week.
  calendar: { glyph: "▧", labelKey: "pills.calendar" },
} as const satisfies Record<string, { glyph: string; labelKey: MessageKey }>;

/** Sort pill segments for the Tasks backlog (see `TaskSort` in data.ts). */
export const SORT_SEGMENTS = [
  { id: "loved", glyph: "♥", labelKey: "pills.loved" },
  { id: "new", glyph: "◷", labelKey: "pills.new" },
  { id: "manual", glyph: "⠿", labelKey: "pills.manual" },
] as const satisfies readonly {
  id: string;
  glyph: string;
  labelKey: MessageKey;
}[];
