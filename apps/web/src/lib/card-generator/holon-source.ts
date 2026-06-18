// SPDX-License-Identifier: AGPL-3.0-or-later
import type { HoloSphere } from "holosphere";
import type { Card, CardType } from "./types";

/**
 * Item sources that can be turned into printable cards from a holon's current
 * data. Each source maps to a holosphere lens and a card action type. Scanning
 * a generated card joins that specific item (see {@link Card.itemId}).
 */
export type HolonSource = "tasks" | "events" | "roles";

export const HOLON_SOURCES: {
  value: HolonSource;
  label: string;
  lens: string;
  cardType: CardType;
}[] = [
  { value: "tasks", label: "Tasks", lens: "quests", cardType: "task" },
  { value: "events", label: "Events", lens: "quests", cardType: "event" },
  { value: "roles", label: "Roles", lens: "roles", cardType: "role" },
];

/**
 * Load the holon's current items for a given source and map them to cards.
 * Each card carries the item's storage key as {@link Card.itemId} so that
 * scanning the card adds the user to that existing item rather than creating a
 * new one. Completed/cancelled tasks are skipped.
 */
export async function loadCardsFromHolon(
  holosphere: HoloSphere,
  holonId: string,
  source: HolonSource,
): Promise<Card[]> {
  const config = HOLON_SOURCES.find((s) => s.value === source);
  if (!config || !holonId) return [];

  const items: any[] = (await holosphere.getAll(holonId, config.lens)) || [];
  const cards: Card[] = [];

  for (const item of items) {
    if (!item || !item.title) continue;

    const itemType = String(item.type || "").toLowerCase();
    if (source === "tasks") {
      // The "quests" lens holds both tasks and events — keep only non-events,
      // and drop finished work that shouldn't be assignable.
      if (itemType === "event") continue;
      const status = String(item.status || "").toLowerCase();
      if (status === "completed" || status === "cancelled") continue;
    } else if (source === "events") {
      if (itemType !== "event") continue;
    }

    const key = String(item.id ?? item.title);
    cards.push({
      id: key,
      itemId: key,
      title: String(item.title),
      type: config.cardType,
      description: typeof item.description === "string" ? item.description : "",
    });
  }

  return cards;
}
