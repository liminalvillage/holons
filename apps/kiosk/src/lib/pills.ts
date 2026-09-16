// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shared segment vocabulary for the PillSwitch controls, so every view's
// pills speak the same visual language: one card at a time is a "Card",
// rows are a "List", a grid of items is a "Wall", the roles week grid is
// "Week". Each view spreads these over its own persisted mode ids (which
// predate the shared naming and must not change — they're stored per
// device). Icons are catalog names (`$lib/icons`), drawn inline so they look
// the same on every device; labels are catalog keys — resolved with `$t`
// where they render, so a language switch re-labels the pills live.

import type { MessageKey } from "./i18n";
import type { IconName } from "./icons";

/** Layout segment looks, keyed by what the layout *is*, not per-view names. */
export const LAYOUT_SEGMENTS = {
  card: { icon: "card", labelKey: "pills.card" },
  list: { icon: "list", labelKey: "pills.list" },
  wall: { icon: "grid", labelKey: "pills.wall" },
  week: { icon: "rows", labelKey: "pills.week" },
  graph: { icon: "graph", labelKey: "pills.graph" },
  // The dated board: the same items laid out over time.
  calendar: { icon: "calendar", labelKey: "pills.calendar" },
  // The balance sheet: who is owed, who owes. Scales, not a list — the rows
  // are positions, not items.
  balances: { icon: "scales", labelKey: "pills.balances" },
  mine: { icon: "user-circle", labelKey: "pills.mine" },
} as const satisfies Record<string, { icon: IconName; labelKey: MessageKey }>;

/** Sort pill segments for the Tasks backlog (see `TaskSort` in data.ts). */
export const SORT_SEGMENTS = [
  { id: "loved", icon: "heart", labelKey: "pills.loved" },
  { id: "new", icon: "clock", labelKey: "pills.new" },
  { id: "manual", icon: "grip", labelKey: "pills.manual" },
] as const satisfies readonly {
  id: string;
  icon: IconName;
  labelKey: MessageKey;
}[];
