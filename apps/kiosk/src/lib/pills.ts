// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shared segment vocabulary for the PillSwitch controls, so every view's
// pills speak the same visual language: one card at a time is a "Card" (❏),
// rows are a "List" (☰), a grid of items is a "Wall" (▦), the roles week
// grid is "Week" (▤). Each view spreads these over its own persisted mode
// ids (which predate the shared naming and must not change — they're stored
// per device).

/** Layout segment looks, keyed by what the layout *is*, not per-view names. */
export const LAYOUT_SEGMENTS = {
  card: { glyph: "❏", label: "Card" },
  list: { glyph: "☰", label: "List" },
  wall: { glyph: "▦", label: "Wall" },
  week: { glyph: "▤", label: "Week" },
} as const;

/** Sort pill segments for the Tasks backlog (see `TaskSort` in data.ts). */
export const SORT_SEGMENTS = [
  { id: "loved", glyph: "♥", label: "Loved" },
  { id: "new", glyph: "◷", label: "New" },
  { id: "manual", glyph: "⠿", label: "Manual" },
] as const;
