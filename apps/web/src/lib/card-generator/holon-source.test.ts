// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { loadCardsFromHolon } from "./holon-source";
import type { HoloSphere } from "holosphere";

/** Minimal holosphere stub: getAll returns the records seeded per lens. */
function stubHolosphere(byLens: Record<string, any[]>): HoloSphere {
  return {
    getAll: async (_holon: string, lens: string) => byLens[lens] ?? [],
  } as unknown as HoloSphere;
}

describe("loadCardsFromHolon", () => {
  it("maps active tasks to cards carrying the item's storage key", async () => {
    const hs = stubHolosphere({
      quests: [
        { id: "q1", title: "Clean Kitchen", description: "Tidy up", type: "task", status: "pending" },
        { id: "q2", title: "Water Plants", type: "task" },
      ],
    });

    const cards = await loadCardsFromHolon(hs, "holon1", "tasks");

    expect(cards).toEqual([
      { id: "q1", itemId: "q1", title: "Clean Kitchen", type: "task", description: "Tidy up" },
      { id: "q2", itemId: "q2", title: "Water Plants", type: "task", description: "" },
    ]);
  });

  it("skips events and finished tasks when loading tasks", async () => {
    const hs = stubHolosphere({
      quests: [
        { id: "q1", title: "Active", type: "task", status: "ongoing" },
        { id: "q2", title: "Done", type: "task", status: "completed" },
        { id: "q3", title: "Gone", type: "task", status: "cancelled" },
        { id: "e1", title: "Standup", type: "event" },
      ],
    });

    const cards = await loadCardsFromHolon(hs, "holon1", "tasks");

    expect(cards.map((c) => c.id)).toEqual(["q1"]);
  });

  it("loads only events as event cards", async () => {
    const hs = stubHolosphere({
      quests: [
        { id: "q1", title: "A task", type: "task" },
        { id: "e1", title: "Standup", type: "event" },
      ],
    });

    const cards = await loadCardsFromHolon(hs, "holon1", "events");

    expect(cards).toEqual([
      { id: "e1", itemId: "e1", title: "Standup", type: "event", description: "" },
    ]);
  });

  it("maps roles to role cards keyed by role id", async () => {
    const hs = stubHolosphere({
      roles: [
        { id: "Facilitator", title: "Facilitator", description: "Runs meetings", participants: [] },
      ],
    });

    const cards = await loadCardsFromHolon(hs, "holon1", "roles");

    expect(cards).toEqual([
      { id: "Facilitator", itemId: "Facilitator", title: "Facilitator", type: "role", description: "Runs meetings" },
    ]);
  });

  it("falls back to the title as key when an item has no id, and skips untitled items", async () => {
    const hs = stubHolosphere({
      quests: [
        { title: "No Id Task", type: "task" },
        { id: "noTitle", type: "task" },
      ],
    });

    const cards = await loadCardsFromHolon(hs, "holon1", "tasks");

    expect(cards).toEqual([
      { id: "No Id Task", itemId: "No Id Task", title: "No Id Task", type: "task", description: "" },
    ]);
  });
});
