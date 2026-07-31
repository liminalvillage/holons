// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  dueLabelFor,
  toBacklog,
  toEvents,
  toRoles,
  toThings,
  toSuggestions,
} from "./data";
import type { Quest } from "@holons/core/tasks";
import type { LibraryItem } from "@holons/core/library";
import type { Role } from "@holons/core/roles";

function quest(id: string, extra: Partial<Quest> = {}): Quest {
  return { id, title: id, status: "ongoing", participants: [], ...extra };
}

describe("toBacklog — dependency-aware ordering", () => {
  it("marks self-standing tasks and current leaves as unblocked", () => {
    const out = toBacklog([
      quest("solo"),
      quest("next", { dependencies: ["done"] }),
      quest("done", { status: "completed" }),
    ]);
    expect(out.map((t) => [t.id, t.unmetDeps])).toEqual([
      ["next", 0],
      ["solo", 0],
    ]);
  });

  it("sorts current leaves before tasks with open dependencies", () => {
    const out = toBacklog([
      quest("blocked", { dependencies: ["leaf"] }),
      quest("leaf"),
    ]);
    expect(out.map((t) => t.id)).toEqual(["leaf", "blocked"]);
    expect(out[1].unmetDeps).toBe(1);
  });

  it("keeps a blocked task behind leaves even with a lower orderIndex", () => {
    const out = toBacklog([
      quest("blocked", { dependencies: ["leaf"], orderIndex: 0 }),
      quest("leaf", { orderIndex: 5 }),
    ]);
    expect(out.map((t) => t.id)).toEqual(["leaf", "blocked"]);
  });

  it("manual sort orders by orderIndex then title within each group", () => {
    const out = toBacklog(
      [
        quest("z-leaf"),
        quest("a-leaf", { orderIndex: 1 }),
        quest("b-blocked", { dependencies: ["z-leaf"] }),
        quest("a-blocked", { dependencies: ["z-leaf"] }),
      ],
      undefined,
      "manual",
    );
    expect(out.map((t) => t.id)).toEqual([
      "a-leaf",
      "z-leaf",
      "a-blocked",
      "b-blocked",
    ]);
  });

  it("defaults to loved: appreciation, then newest first, then title", () => {
    const out = toBacklog([
      quest("old-loved", {
        created: "2026-01-01T00:00:00Z",
        appreciation: [{ id: 1 }, { id: 2 }] as any,
      }),
      quest("new-plain", { created: "2026-06-01T00:00:00Z" }),
      quest("old-plain", { created: "2026-01-01T00:00:00Z" }),
      quest("a-dateless"),
    ]);
    expect(out.map((t) => t.id)).toEqual([
      "old-loved", // appreciation outranks recency
      "new-plain", // newest of the unappreciated
      "old-plain",
      "a-dateless", // no created date sorts last despite the title
    ]);
  });

  it("loved ignores orderIndex; manual honours it", () => {
    const quests = [
      quest("loved", {
        created: "2026-06-01T00:00:00Z",
        appreciation: [{ id: 1 }] as any,
      }),
      quest("pinned", { orderIndex: 0, created: "2026-01-01T00:00:00Z" }),
    ];
    expect(toBacklog(quests).map((t) => t.id)).toEqual(["loved", "pinned"]);
    expect(toBacklog(quests, undefined, "manual").map((t) => t.id)).toEqual([
      "pinned",
      "loved",
    ]);
  });

  it("new sort is strictly newest first regardless of appreciation", () => {
    const out = toBacklog(
      [
        quest("old-loved", {
          created: "2026-01-01T00:00:00Z",
          appreciation: [{ id: 1 }, { id: 2 }] as any,
        }),
        quest("newest", { created: "2026-06-01T00:00:00Z" }),
      ],
      undefined,
      "new",
    );
    expect(out.map((t) => t.id)).toEqual(["newest", "old-loved"]);
  });

  it("counts only still-open dependencies", () => {
    const out = toBacklog([
      quest("t", { dependencies: ["d1", "d2", "gone"] }),
      quest("d1", { status: "completed" }),
      quest("d2"),
    ]);
    const t = out.find((x) => x.id === "t")!;
    expect(t.unmetDeps).toBe(1);
  });
});

describe("toSuggestions — search dropdown chips", () => {
  const person = (id: number, first: string) => ({ id, first_name: first });

  it("collects sorted distinct categories from events and backlog", () => {
    const quests = [
      quest("t1", { category: "garden" }),
      quest("t2", { category: "kitchen" }),
      quest("t3", { category: "garden" }),
      quest("e1", { category: "assembly", when: "2099-01-01T10:00:00Z" }),
      quest("t4"), // no category — must not produce a blank chip
    ];
    const s = toSuggestions(toEvents(quests), toBacklog(quests), [], []);
    expect(s.categories).toEqual(["assembly", "garden", "kitchen"]);
  });

  it("gathers people from participants, initiators, roles and borrowers", () => {
    const quests = [
      quest("t1", {
        participants: [person(1, "Anna")],
        initiator: { id: 9, firstName: "Ida" },
      }),
      quest("e1", {
        when: "2099-01-01T10:00:00Z",
        participants: [person(2, "Bruno")],
      }),
    ];
    const roles: Role[] = [
      { id: "r1", title: "Gardener", participants: [person(3, "Carla")] },
    ];
    const things: LibraryItem[] = [
      {
        id: "drill",
        type: "tool",
        category: "tools",
        description: "",
        value: 0,
        created: "2026-01-01",
        borrowed: true,
        borrower: "Dario",
      },
    ];
    const s = toSuggestions(
      toEvents(quests),
      toBacklog(quests),
      toRoles(roles),
      toThings(things),
    );
    expect(s.people).toEqual(["Anna", "Bruno", "Carla", "Dario", "Ida"]);
  });

  it("dedupes people case-insensitively, first spelling wins", () => {
    const quests = [
      quest("t1", { participants: [person(1, "Anna")] }),
      quest("t2", { participants: [person(2, "anna")] }),
    ];
    const s = toSuggestions([], toBacklog(quests), [], []);
    expect(s.people).toEqual(["Anna"]);
  });
});

describe("dueLabelFor", () => {
  const noon = new Date("2026-07-26T12:00:00");
  const day = (offset: number, hour = 9) =>
    new Date(2026, 6, 26 + offset, hour);

  it("returns null without a due date", () => {
    expect(dueLabelFor(null, noon)).toBeNull();
    expect(dueLabelFor(undefined, noon)).toBeNull();
  });

  it("labels the near days by name", () => {
    expect(dueLabelFor(day(0), noon)).toBe("today");
    expect(dueLabelFor(day(1), noon)).toBe("tomorrow");
    expect(dueLabelFor(day(-1), noon)).toBe("yesterday");
  });

  it("compares calendar days, not 24h spans", () => {
    // 23:30 tonight → 00:30 tomorrow is < 24h apart but a day boundary.
    expect(dueLabelFor(day(1, 0), new Date(2026, 6, 26, 23, 30))).toBe(
      "tomorrow",
    );
  });

  it("counts days inside a week, both directions", () => {
    expect(dueLabelFor(day(3), noon)).toBe("in 3d");
    expect(dueLabelFor(day(6), noon)).toBe("in 6d");
    expect(dueLabelFor(day(-4), noon)).toBe("4d ago");
  });

  it("falls back to a short date from a week out", () => {
    const label = dueLabelFor(day(7), noon);
    expect(label).not.toMatch(/in \d+d/);
    expect(label).toContain("2"); // "2 Aug" / "Aug 2" per locale
  });
});

describe("toThings — borrow state mapping", () => {
  it("carries borrower id and parsed return date for the my-things filter", () => {
    const items = [
      {
        id: "Drill",
        type: "tool",
        borrowed: true,
        borrower: "Roberto",
        borrowerId: "235",
        returnBy: "2026-07-30",
      },
      { id: "Ladder", type: "tool", borrowed: false },
    ] as unknown as LibraryItem[];
    const out = toThings(items);
    const drill = out.find((t) => t.id === "Drill")!;
    expect(drill.available).toBe(false);
    expect(drill.borrowerId).toBe("235");
    expect(drill.returnBy).toBeInstanceOf(Date);
    const ladder = out.find((t) => t.id === "Ladder")!;
    expect(ladder.available).toBe(true);
    expect(ladder.borrowerId).toBeNull();
    expect(ladder.returnBy).toBeNull();
  });
});
