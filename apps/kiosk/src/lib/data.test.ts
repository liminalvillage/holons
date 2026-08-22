// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { makeTranslator } from "./i18n";
import {
  dueLabelFor,
  toBacklog,
  toBookingEvents,
  toChecklists,
  toEvents,
  toRoles,
  toThings,
  toSuggestions,
} from "./data";
import type { Quest } from "@holons/core/tasks";
import type { LibraryItem } from "@holons/core/library";
import type { Role } from "@holons/core/roles";
import type { Checklist } from "@holons/core/checklists";

function quest(id: string, extra: Partial<Quest> = {}): Quest {
  return { id, title: id, status: "ongoing", participants: [], ...extra };
}

describe("toEvents — spans", () => {
  it("carries a multi-day range through as an inclusive span", () => {
    const [ev] = toEvents([
      quest("festival", { when: "2026-08-20", ends: "2026-08-22" }),
    ]);
    expect(ev.allDay).toBe(true);
    expect(ev.days).toBe(3);
    expect(ev.multiDay).toBe(true);
    // The first day is the card's own date; the end is the LAST day, not a
    // boundary past it — the calendar shows the card on all three.
    expect(ev.date).toEqual(new Date(2026, 7, 20));
    expect(ev.end).toEqual(new Date(2026, 7, 22));
  });

  it("leaves an ordinary same-day card at one day", () => {
    const [allDay] = toEvents([quest("standup", { when: "2026-08-20" })]);
    expect([allDay.days, allDay.multiDay, allDay.end]).toEqual([
      1,
      false,
      undefined,
    ]);
    const [timed] = toEvents([
      quest("meet", {
        when: new Date(2026, 7, 20, 9, 0).toISOString(),
        ends: new Date(2026, 7, 20, 17, 0).toISOString(),
      }),
    ]);
    expect([timed.allDay, timed.days, timed.multiDay]).toEqual([
      false,
      1,
      false,
    ]);
    expect(timed.end).toEqual(new Date(2026, 7, 20, 17, 0));
  });
});

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

  it("carries the stored dependencies verbatim, for the graph's edges", () => {
    const out = toBacklog([
      quest("t", { dependencies: ["d1", "d2", "gone"] }),
      quest("d1", { status: "completed" }),
      quest("d2"),
    ]);
    const t = out.find((x) => x.id === "t")!;
    // The raw list, untouched — the graph drops edges that lead nowhere
    // (d1 settled and off the board, "gone" isn't a quest at all), while
    // unmetDeps counts only the still-open subset (d2).
    expect(t.dependencies).toEqual(["d1", "d2", "gone"]);
    expect(t.unmetDeps).toBe(1);
    expect(out.find((x) => x.id === "d2")!.dependencies).toEqual([]);
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
  const tEn = makeTranslator("en");
  const tIt = makeTranslator("it");

  it("returns null without a due date", () => {
    expect(dueLabelFor(null, noon, tEn, "en")).toBeNull();
    expect(dueLabelFor(undefined, noon, tEn, "en")).toBeNull();
  });

  it("labels the near days by name", () => {
    expect(dueLabelFor(day(0), noon, tEn, "en")).toBe("today");
    expect(dueLabelFor(day(1), noon, tEn, "en")).toBe("tomorrow");
    expect(dueLabelFor(day(-1), noon, tEn, "en")).toBe("yesterday");
  });

  it("labels in the selected language", () => {
    expect(dueLabelFor(day(0), noon, tIt, "it")).toBe("oggi");
    expect(dueLabelFor(day(3), noon, tIt, "it")).toBe("tra 3g");
  });

  it("compares calendar days, not 24h spans", () => {
    // 23:30 tonight → 00:30 tomorrow is < 24h apart but a day boundary.
    expect(
      dueLabelFor(day(1, 0), new Date(2026, 6, 26, 23, 30), tEn, "en"),
    ).toBe("tomorrow");
  });

  it("counts days inside a week, both directions", () => {
    expect(dueLabelFor(day(3), noon, tEn, "en")).toBe("in 3d");
    expect(dueLabelFor(day(6), noon, tEn, "en")).toBe("in 6d");
    expect(dueLabelFor(day(-4), noon, tEn, "en")).toBe("4d ago");
  });

  it("falls back to a short date from a week out", () => {
    const label = dueLabelFor(day(7), noon, tEn, "en");
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

describe("toBookingEvents — library bookings as calendar spans", () => {
  const drill = {
    id: "Drill",
    type: "tool",
    bookings: [
      {
        id: "b1",
        start: "2026-09-01",
        end: "2026-09-03",
        borrowerId: "235",
        borrower: "Roberto",
        created: "2026-08-20T10:00:00.000Z",
      },
      {
        id: "b2",
        start: "2026-09-10",
        end: "2026-09-10",
        borrowerId: "77",
        borrower: "Ana",
        created: "2026-08-21T10:00:00.000Z",
      },
    ],
  } as unknown as LibraryItem;

  it("makes one inclusive all-day span per booking, soonest first", () => {
    const spans = toBookingEvents([drill]);
    expect(spans.map((s) => s.id)).toEqual([
      "booking-Drill-b1",
      "booking-Drill-b2",
    ]);
    const [first, second] = spans;
    expect(first.allDay).toBe(true);
    expect(first.date).toEqual(new Date(2026, 8, 1));
    // The end is the LAST booked day, not a boundary past it — three days out.
    expect(first.end).toEqual(new Date(2026, 8, 3));
    expect([first.days, first.multiDay]).toEqual([3, true]);
    // A one-day booking is a plain card, not a span.
    expect([second.days, second.multiDay]).toEqual([1, false]);
  });

  it("points every span back at its item, and colours by item", () => {
    const spans = toBookingEvents([drill]);
    expect(spans.every((s) => s.libraryItemId === "Drill")).toBe(true);
    expect(spans.every((s) => s.title === "Drill")).toBe(true);
    // `category` is the item, so the note-colour hash is per item — both of
    // the Drill's spans read as the same thing on the board.
    expect(new Set(spans.map((s) => s.category))).toEqual(new Set(["Drill"]));
  });

  it("carries the borrower as the span's person, for the Mine scope", () => {
    const [span] = toBookingEvents([drill]);
    expect(span.people).toEqual([{ id: "235", name: "Roberto" }]);
  });

  it("synthesizes a span from the legacy single-borrow fields", () => {
    const legacy = {
      id: "Ladder",
      type: "tool",
      borrowed: true,
      borrower: "Ana",
      borrowerId: "77",
      borrowedAt: "2026-09-05",
      returnBy: "2026-09-07",
    } as unknown as LibraryItem;
    const [span] = toBookingEvents([legacy]);
    expect(span.date).toEqual(new Date(2026, 8, 5));
    expect(span.end).toEqual(new Date(2026, 8, 7));
    expect(span.days).toBe(3);
  });

  it("skips never-booked and deleted items, and federated duplicates", () => {
    const free = { id: "Saw", type: "tool", borrowed: false };
    const gone = { ...drill, id: "Axe", _deleted: true };
    const dupe = { ...drill };
    const spans = toBookingEvents([
      drill,
      dupe,
      free,
      gone,
    ] as unknown as LibraryItem[]);
    expect(spans).toHaveLength(2); // the Drill's two bookings, once
  });
});

describe("toChecklists — list card mapping", () => {
  it("counts done items, pins special lists first, then alphabetical", () => {
    const lists = [
      {
        id: "weekend build",
        type: "checklist",
        items: [
          { text: "sand", checked: true },
          { text: "paint", checked: false },
        ],
      },
      { id: "shopping", type: "shopping", items: [] },
      { id: "cleaning", type: "checklist", items: [] },
    ] as unknown as Checklist[];
    const out = toChecklists(lists);
    expect(out.map((c) => c.id)).toEqual([
      "shopping",
      "cleaning",
      "weekend build",
    ]);
    const build = out.find((c) => c.id === "weekend build")!;
    expect(build.done).toBe(1);
    expect(build.total).toBe(2);
    expect(build.special).toBe(false);
    expect(out[0].special).toBe(true);
    expect(out[0].icon).toBe("🛒");
  });

  it("types legacy records so agenda/shopping ids read as special", () => {
    const out = toChecklists([
      { id: "agenda", items: [] },
    ] as unknown as Checklist[]);
    expect(out[0].special).toBe(true);
    expect(out[0].icon).toBe("📅");
  });

  it("drops blank ids, and dedupes on the origin-qualified key", () => {
    const out = toChecklists([
      { id: "chores", items: [] },
      { id: "chores", items: [], _federation: { origin: "999" } },
      // Same partner, same list, emitted twice — one card.
      { id: "chores", items: [], _federation: { origin: "999" } },
      { items: [] },
    ] as unknown as Checklist[]);
    // A partner's `chores` is a DIFFERENT list from ours; both belong on the
    // board. Keying on the bare id used to collapse them into one.
    expect(out.map((c) => c.key)).toEqual(["chores", "999::chores"]);
  });

  it("keeps a partner's same-named list, ours first", () => {
    // `shopping` exists under that exact id in every holon — the case that
    // made the Lists board look like it received no federated data at all.
    const out = toChecklists([
      { id: "shopping", type: "shopping", items: [] },
      {
        id: "shopping",
        type: "shopping",
        items: [{ text: "oats", checked: false }],
        _federation: { origin: "-100294", originName: "Neighbours" },
      },
    ] as unknown as Checklist[]);
    expect(out).toHaveLength(2);
    expect(out[0].key).toBe("shopping");
    expect(out[0].source).toBeUndefined();
    expect(out[1].key).toBe("-100294::shopping");
    expect(out[1].source).toBe("Neighbours");
    // The record's own id is untouched — that's what a write targets.
    expect(out[1].id).toBe("shopping");
    expect(out[1].total).toBe(1);
  });

  it("does not mutate the raw record when typing legacy lists", () => {
    const raw = { id: "agenda", items: [] } as unknown as Checklist;
    toChecklists([raw]);
    expect(raw.type).toBeUndefined();
  });
});

describe("hologram flag — projection cards", () => {
  const envelope = {
    _hologram: {
      isHologram: true,
      sourceHolon: "-100999",
      sourceHolonName: "Partner",
    },
  };

  it("marks hologram quests on the backlog and calendar, not plain ones", () => {
    const backlog = toBacklog([
      quest("mirrored", envelope as Partial<Quest>),
      quest("own"),
    ]);
    expect(backlog.find((t) => t.id === "mirrored")?.hologram).toBe(true);
    expect(backlog.find((t) => t.id === "own")?.hologram).toBe(false);
    const events = toEvents([
      quest("dated", { when: "2026-08-10", ...envelope } as Partial<Quest>),
    ]);
    expect(events[0].hologram).toBe(true);
  });

  it("does not flag federation-aggregated copies as holograms", () => {
    const out = toBacklog([
      quest("aggregated", {
        _federation: { origin: "-100888" },
      } as Partial<Quest>),
    ]);
    expect(out[0].hologram).toBe(false);
    // …but they still carry the source glow.
    expect(out[0].sourceColor).toBeDefined();
  });

  it("holoSeed spreads cards across [0,1) deterministically", async () => {
    const { holoSeed } = await import("./data");
    const seeds = ["holo-task", "holo-event", "holo-other"].map(holoSeed);
    for (const s of seeds) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(1);
    }
    expect(new Set(seeds).size).toBe(3);
    expect(holoSeed("holo-task")).toBe(seeds[0]);
  });

  it("flags hologram roles, things and checklists too", () => {
    expect(
      toRoles([{ id: "r", title: "r", ...envelope } as unknown as Role])[0]
        .hologram,
    ).toBe(true);
    expect(
      toThings([{ id: "thing", ...envelope } as unknown as LibraryItem])[0]
        .hologram,
    ).toBe(true);
    expect(
      toChecklists([
        { id: "list", items: [], ...envelope } as unknown as Checklist,
      ])[0].hologram,
    ).toBe(true);
  });
});
