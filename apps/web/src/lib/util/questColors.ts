// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Quest color for calendar chips and timeline dots. Delegates to
 * @holons/core/categories — the same palette TaskCardShell uses — so an
 * item renders the exact same color on the calendar, in the unscheduled
 * drawer, and on the kanban/list/canvas views. An explicit `item.color`
 * always wins; completed items go the same neutral gray as completed
 * cards.
 */

import { getColorFromCategory } from "@holons/core/categories";

// Matches TaskCardShell's completed-card background.
export const COMPLETED_QUEST_COLOR = "#374151";

export function questColor(
  item:
    | { color?: string; category?: string; type?: string; status?: string }
    | null
    | undefined,
): string {
  if (item?.color) return item.color;
  if (item?.status === "completed") return COMPLETED_QUEST_COLOR;
  return getColorFromCategory(item?.category, item?.type ?? "task");
}
