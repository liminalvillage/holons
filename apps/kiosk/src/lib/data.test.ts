// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { makeTranslator } from "./i18n";
import {
  dueLabelFor,
  personName,
  toBacklog,
  toBookingEvents,
  toChecklists,
  toEvents,
  toExternalEvents,
  externalEventColor,
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

describe("toEvents — recurring series", () => {
  const now = new Date(2026, 8, 10, 12); // 10 Sep 2026

  it("draws one event per occurrence, keyed to the series", () => {
    const evs = toEvents(
      [quest("standup", { when: "2026-09-01", frequency: "weekly" })],
      undefined,
      undefined,
      undefined,
      now,
    );
    // A season back → a year and a half ahead: Sep 1 is the first in view.
    expect(evs[0].id).toBe("standup::2026-09-01");
    expect(evs[0].date).toEqual(new Date(2026, 8, 1));
    expect(evs[1].date).toEqual(new Date(2026, 8, 8));
    expect(evs[0].occurrence).toEqual({
      seriesId: "standup",
      when: "2026-09-01",
      completed: false,
      frequency: "weekly",
    });
    // Ids stay unique across the run so view keys never collide.
    expect(new Set(evs.map((e) => e.id)).size).toBe(evs.length);
    // No card for the series record itself.
    expect(evs.some((e) => e.id === "standup")).toBe(false);
  });

  it("carries the series' span and flags ticked-off occurrences", () => {
    const evs = toEvents(
      [
        quest("retreat", {
          when: "2026-09-04",
          ends: "2026-09-06",
          frequency: "monthly",
          completedOccurrences: ["2026-10-04"],
        }),
      ],
      undefined,
      undefined,
      undefined,
      now,
    );
    expect(evs[0].days).toBe(3);
    expect(evs[0].end).toEqual(new Date(2026, 8, 6));
    expect(evs[1].occurrence?.completed).toBe(true);
  });

  it("draws a series that starts beyond the window as its own start", () => {
    const [ev] = toEvents(
      [quest("far", { when: "2030-01-01", frequency: "weekly" })],
      undefined,
      undefined,
      undefined,
      now,
    );
    expect(ev.id).toBe("far");
    expect(ev.occurrence).toBeUndefined();
  });

  it("leaves a one-off alone", () => {
    const [ev] = toEvents(
      [quest("once", { when: "2026-09-12" })],
      undefined,
      undefined,
      undefined,
      now,
    );
    expect(ev.id).toBe("once");
    expect(ev.occurrence).toBeUndefined();
  });
});

describe("toBacklog — recurring tasks", () => {
  const now = new Date(2026, 8, 10, 12);

  it("is due on the next open occurrence, and says it repeats", () => {
    const [task] = toBacklog(
      [
        quest("bins", {
          when: "2026-09-01",
          frequency: "weekly",
          completedOccurrences: ["2026-09-15"],
        }),
      ],
      undefined,
      "loved",
      undefined,
      undefined,
      now,
    );
    expect(task.frequency).toBe("weekly");
    expect(task.due).toEqual(new Date(2026, 8, 22));
  });

  it("keeps a one-off's own date and no cadence", () => {
    const [task] = toBacklog(
      [quest("once", { when: "2026-09-01" })],
      undefined,
      "loved",
      undefined,
      undefined,
      now,
    );
    expect(task.frequency).toBeNull();
    expect(task.due).toEqual(new Date(2026, 8, 1));
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
    expect(out[0].icon).toBe("cart");
  });

  it("types legacy records so agenda/shopping ids read as special", () => {
    const out = toChecklists([
      { id: "agenda", items: [] },
    ] as unknown as Checklist[]);
    expect(out[0].special).toBe(true);
    expect(out[0].icon).toBe("calendar");
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

describe("toExternalEvents — a calendar the holon follows", () => {
  const feed = {
    id: "cal_1",
    url: "https://example.com/rooms.ics",
    name: "Room bookings",
    enabled: true,
  };
  const occurrence = (over: Record<string, unknown> = {}) => ({
    id: "uid-1",
    title: "Yoga",
    start: new Date(2026, 4, 7, 9, 0),
    end: new Date(2026, 4, 7, 10, 0),
    allDay: false,
    calendarUrl: feed.url,
    ...over,
  });

  it("namespaces ids by feed, so two calendars can share a UID", () => {
    const [a] = toExternalEvents([occurrence()], feed);
    const [b] = toExternalEvents([occurrence()], { ...feed, id: "cal_2" });
    expect(a.id).toBe("ext:cal_1:uid-1");
    expect(b.id).toBe("ext:cal_2:uid-1");
  });

  it("marks the event as external so the board won't drag or open it", () => {
    const [ev] = toExternalEvents([occurrence()], feed);
    expect(ev.external).toEqual({
      calendarName: "Room bookings",
      url: feed.url,
    });
    expect(ev.people).toEqual([]);
    expect(ev.multiDay).toBe(false);
    expect(ev.days).toBe(1);
  });

  it("draws a one-day all-day entry on one day (iCal DTEND is exclusive)", () => {
    const [ev] = toExternalEvents(
      [
        occurrence({
          allDay: true,
          start: new Date(2026, 0, 1),
          end: new Date(2026, 0, 2),
        }),
      ],
      feed,
    );
    expect(ev.allDay).toBe(true);
    expect(ev.days).toBe(1);
    expect(ev.end?.getDate()).toBe(1);
  });

  it("paints every entry of a feed in the feed's colour", () => {
    const chosen = { ...feed, color: "#ffe79a" };
    const [a, b] = toExternalEvents(
      [occurrence(), occurrence({ id: "uid-2" })],
      chosen,
    );
    expect(a.color).toBe("#ffe79a");
    expect(b.color).toBe("#ffe79a");
    expect(externalEventColor(chosen)).toBe("#ffe79a");
  });

  it("falls back to a stable post-it note hashed from the feed id", () => {
    const [ev] = toExternalEvents([occurrence()], feed);
    expect(ev.color).toMatch(/^var\(--note-/);
    expect(ev.color).toBe(externalEventColor(feed));
    expect(externalEventColor({ ...feed, id: "cal_2" })).toBe(
      externalEventColor({ id: "cal_2" }),
    );
  });
});

describe("the two boards stay separate", () => {
  // The `quests` lens is shared: offers, needs and whatever a future domain
  // parks there arrive in the same subscription as tasks and events. Core's
  // `questKind` draws the line; these lock in what each board shows.
  const mixed: Quest[] = [
    quest("chore", { when: "2026-08-20" }),
    quest("standup", { type: "event", when: "2026-08-20" }),
    quest("flour", { type: "offer", when: "2026-08-20" }),
    quest("wanted-flour", { type: "need", when: "2026-08-20" }),
    quest("borrow-drill", { type: "request", when: "2026-08-20" }),
    quest("some-resource", { type: "resource", when: "2026-08-20" }),
  ];

  const at = (y: number, mo: number, d: number) => new Date(y, mo - 1, d, 12);
  const wall = (quests: Quest[], now: Date) =>
    toBacklog(quests, undefined, undefined, undefined, undefined, now)
      .map((t) => t.id)
      .sort();

  it("keeps marketplace and unknown records off the wall", () => {
    expect(wall(mixed, at(2026, 8, 1))).toEqual(["chore", "standup"]);
  });

  it("drops an event from the wall once its day has passed; the task stays", () => {
    expect(wall(mixed, at(2026, 8, 20))).toEqual(["chore", "standup"]);
    expect(wall(mixed, at(2026, 8, 21))).toEqual(["chore"]);
  });

  it("puts a recurring event on the wall once, as its next occurrence", () => {
    const series = [
      quest("circle", {
        type: "event",
        when: "2026-08-05",
        frequency: "weekly",
      }),
    ];
    const out = toBacklog(
      series,
      undefined,
      undefined,
      undefined,
      undefined,
      at(2026, 8, 20),
    );
    expect(out.map((t) => t.id)).toEqual(["circle"]);
    expect(out[0].due).toEqual(new Date(2026, 7, 26));
  });

  it("keeps a past and a completed event on the calendar, drawn as done", () => {
    const past = [
      quest("standup", { type: "event", when: "2026-01-20" }),
      quest("party", {
        type: "event",
        when: "2026-01-21",
        status: "completed",
      }),
      quest("called-off", {
        type: "event",
        when: "2026-01-22",
        status: "cancelled",
      }),
    ];
    const out = toEvents(
      past,
      undefined,
      undefined,
      undefined,
      at(2026, 8, 20),
    );
    expect(out.map((e) => [e.id, !!e.completed])).toEqual([
      ["standup", false],
      ["party", true],
    ]);
    expect(wall(past, at(2026, 8, 20))).toEqual([]);
  });

  it("draws a completed series up to today and no further", () => {
    const ended = [
      quest("circle", {
        type: "event",
        when: "2026-08-05",
        frequency: "weekly",
        status: "completed",
      }),
    ];
    const out = toEvents(
      ended,
      undefined,
      undefined,
      undefined,
      at(2026, 8, 20),
    );
    expect(out.map((e) => e.occurrence?.when)).toEqual([
      "2026-08-05",
      "2026-08-12",
      "2026-08-19",
    ]);
    expect(out.every((e) => e.completed)).toBe(true);
  });

  it("keeps offers, needs and unknown records off the calendar too", () => {
    expect(
      toEvents(mixed)
        .map((e) => e.id)
        .sort(),
    ).toEqual(["chore", "standup"]);
  });

  it("still calls an untyped record a task — the historical default", () => {
    const legacy = [quest("old", { type: undefined })];
    expect(toBacklog(legacy).map((t) => t.id)).toEqual(["old"]);
  });

  it("folds the legacy task spellings onto the wall", () => {
    const out = toBacklog([
      quest("a", { type: "quest" }),
      quest("b", { type: "recurring" }),
      quest("c", { type: "Task" }),
    ]);
    expect(out.map((t) => t.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("leaves an undated event off the calendar without adding it to the wall", () => {
    const orphan = [quest("someday", { type: "event" })];
    expect(toEvents(orphan)).toEqual([]);
    expect(toBacklog(orphan)).toEqual([]);
  });
});

describe("personName — first name and a dotted surname", () => {
  it("reads 'First S.' when both names are there", () => {
    expect(personName({ first_name: "Roberto", last_name: "Valenti" })).toBe(
      "Roberto V.",
    );
  });

  it("accepts the initiator's camelCase shape", () => {
    expect(personName({ firstName: "Ada", lastName: "lovelace" })).toBe(
      "Ada L.",
    );
  });

  it("never shows a handle when a name exists", () => {
    expect(personName({ first_name: "Sam", username: "samwise" })).toBe("Sam");
    expect(personName({ last_name: "Ng", username: "ng" })).toBe("N.");
  });

  it("falls back to the bare username, then the id", () => {
    expect(personName({ username: "samwise", id: 4 })).toBe("samwise");
    expect(personName({ id: 4 })).toBe("#4");
    expect(personName(undefined)).toBe("#?");
  });
});
