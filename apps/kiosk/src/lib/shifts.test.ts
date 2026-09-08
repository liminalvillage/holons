// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pure view-model helpers of the Shifts board — grouping, capacity and
// matching. The protocol itself (parsing, RSVP resolution) is covered in
// @holons/core/shifts; these specs only cover what the kiosk adds on top.

import { describe, expect, it } from "vitest";
import type { ShiftOccurrence, ShiftRsvp } from "@holons/core/shifts";
import {
  boardSummary,
  groupCoverageByDay,
  groupShiftsByDay,
  isRunningNow,
  mergeOccurrences,
  mergeRsvps,
  occurrenceInputOf,
  participantNames,
  planCoverage,
  shiftMatchesQuery,
  spotsLeft,
  upcomingShifts,
} from "./shifts";
import { localToUnix, type ShiftPlan } from "@holons/core/shifts";

const COORD = "c".repeat(64);

function occ(over: Partial<ShiftOccurrence>): ShiftOccurrence {
  const date = over.date ?? "2026-09-01";
  const code = over.code ?? "mc";
  const dTag = `shift--100-${date}-${code}`;
  return {
    dTag,
    address: `31923:${COORD}:${dTag}`,
    pubkey: COORD,
    groupId: "-100",
    date,
    code,
    title: "Morning café",
    start: 1_000,
    end: 2_000,
    content: "",
    createdAt: 1,
    id: "e1",
    ...over,
  };
}

function rsvp(
  address: string,
  pubkey: string,
  status: ShiftRsvp["status"],
): ShiftRsvp {
  return {
    pubkey,
    address,
    dTag: "rsvp--100-2026-09-01-mc",
    status,
    createdAt: 1,
    id: `r-${pubkey}`,
  };
}

describe("upcomingShifts", () => {
  it("keeps running and future shifts, drops ended ones", () => {
    const past = occ({ id: "a", code: "aa", start: 100, end: 900 });
    const running = occ({ id: "b", code: "bb", start: 900, end: 1_500 });
    const future = occ({ id: "c", code: "cc", start: 5_000, end: 6_000 });
    expect(upcomingShifts([past, running, future], 1_000)).toEqual([
      running,
      future,
    ]);
  });
});

describe("groupShiftsByDay", () => {
  it("groups by the occurrence's own date, days ascending, starts ascending", () => {
    const late = occ({ date: "2026-09-02", code: "lp", start: 9_000 });
    const early = occ({ date: "2026-09-02", code: "mc", start: 3_000 });
    const first = occ({ date: "2026-09-01", code: "dp", start: 7_000 });
    const days = groupShiftsByDay([late, early, first]);
    expect(days.map((d) => d.iso)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(days[1].occurrences.map((o) => o.code)).toEqual(["mc", "lp"]);
  });

  it("returns no rows for no shifts", () => {
    expect(groupShiftsByDay([])).toEqual([]);
  });
});

describe("spotsLeft", () => {
  it("is null without a declared capacity", () => {
    expect(spotsLeft(occ({}), [])).toBeNull();
  });

  it("counts only accepted signups against the capacity", () => {
    const o = occ({ capacity: 3 });
    const rsvps = [
      rsvp(o.address, "p1", "accepted"),
      rsvp(o.address, "p2", "declined"),
      rsvp("31923:other:addr", "p3", "accepted"), // different shift
    ];
    expect(spotsLeft(o, rsvps)).toBe(2);
  });

  it("never goes negative when a shift is over-subscribed", () => {
    const o = occ({ capacity: 1 });
    const rsvps = [
      rsvp(o.address, "p1", "accepted"),
      rsvp(o.address, "p2", "accepted"),
    ];
    expect(spotsLeft(o, rsvps)).toBe(0);
  });
});

describe("isRunningNow", () => {
  it("is true from start (inclusive) to end (exclusive)", () => {
    const o = { start: 1_000, end: 2_000 };
    expect(isRunningNow(o, 999)).toBe(false);
    expect(isRunningNow(o, 1_000)).toBe(true);
    expect(isRunningNow(o, 1_999)).toBe(true);
    expect(isRunningNow(o, 2_000)).toBe(false);
  });
});

describe("mergeRsvps", () => {
  it("replaces the author's previous RSVP for the same occurrence", () => {
    const o = occ({});
    const prev = { ...rsvp(o.address, "p1", "accepted"), createdAt: 10 };
    const next = {
      ...rsvp(o.address, "p1", "declined"),
      createdAt: 11,
      id: "r-new",
    };
    const merged = mergeRsvps([prev], next);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("declined");
  });

  it("leaves other authors and other occurrences alone", () => {
    const o = occ({});
    const other = rsvp("31923:other:addr", "p1", "accepted");
    const peer = rsvp(o.address, "p2", "accepted");
    const merged = mergeRsvps([other, peer], {
      ...rsvp(o.address, "p1", "accepted"),
      createdAt: 99,
    });
    expect(merged).toHaveLength(3);
  });

  it("never lets a stale optimistic RSVP shadow a newer one", () => {
    const o = occ({});
    const newer = { ...rsvp(o.address, "p1", "accepted"), createdAt: 20 };
    const stale = {
      ...rsvp(o.address, "p1", "declined"),
      createdAt: 10,
      id: "r-stale",
    };
    expect(mergeRsvps([newer], stale)[0].status).toBe("accepted");
  });
});

describe("participantNames", () => {
  const a = occ({});
  const pks = ["1".repeat(64), "2".repeat(64), "3".repeat(64)];
  const enrolled = pks.map((pk) => rsvp(a.address, pk, "accepted"));

  it("maps attested names and falls back to hex prefixes", () => {
    const names = new Map([[pks[0], "Alice"]]);
    const { shown, more } = participantNames(a, enrolled, names);
    expect(shown).toEqual(["Alice", `${"2".repeat(8)}…`, `${"3".repeat(8)}…`]);
    expect(more).toBe(0);
  });

  it("caps the list and counts the rest", () => {
    const { shown, more } = participantNames(
      a,
      enrolled,
      new Map(),
      undefined,
      2,
    );
    expect(shown).toHaveLength(2);
    expect(more).toBe(1);
  });

  it("ignores declined signups and handles the empty shift", () => {
    const withDecline = [
      ...enrolled,
      rsvp(a.address, "4".repeat(64), "declined"),
    ];
    expect(participantNames(a, withDecline, new Map()).shown).toHaveLength(3);
    expect(participantNames(a, [], new Map())).toEqual({ shown: [], more: 0 });
  });
});

describe("person-identity collapse", () => {
  // One person, two keys — Elinor's and the Holons-derived one — bridged by
  // a kind-31926 attestation ($lib/shifts builds this map from the relay).
  const elinorKey = "e".repeat(64);
  const holonsKey = "f".repeat(64);
  const identity = new Map([
    [elinorKey, "telegram:1"],
    [holonsKey, "telegram:1"],
  ]);

  it("a cancel under a sibling key frees the person's spot", () => {
    const o = occ({ capacity: 2 });
    const rsvps = [
      { ...rsvp(o.address, holonsKey, "accepted"), createdAt: 10 },
      { ...rsvp(o.address, elinorKey, "declined"), createdAt: 11 },
    ];
    expect(spotsLeft(o, rsvps)).toBe(1); // per-key view still holds the spot
    expect(spotsLeft(o, rsvps, identity)).toBe(2);
    expect(participantNames(o, rsvps, new Map(), identity).shown).toEqual([]);
  });

  it("counts a two-keyed person once and shows them once", () => {
    const o = occ({ capacity: 3 });
    const rsvps = [
      { ...rsvp(o.address, holonsKey, "accepted"), createdAt: 10 },
      { ...rsvp(o.address, elinorKey, "accepted"), createdAt: 11 },
    ];
    expect(spotsLeft(o, rsvps, identity)).toBe(2);
    const names = new Map([[elinorKey, "Roberto"]]);
    expect(participantNames(o, rsvps, names, identity).shown).toEqual([
      "Roberto",
    ]);
  });

  it("the optimistic merge collapses across the person's keys too", () => {
    const o = occ({});
    const prev = { ...rsvp(o.address, elinorKey, "accepted"), createdAt: 10 };
    const merged = mergeRsvps(
      [prev],
      { ...rsvp(o.address, holonsKey, "declined"), createdAt: 11 },
      identity,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("declined");
  });
});

describe("shiftMatchesQuery", () => {
  it("matches case-insensitively over title, location and code", () => {
    const o = occ({ title: "Morning café", location: "Bar", code: "mc" });
    expect(shiftMatchesQuery(o, "")).toBe(true);
    expect(shiftMatchesQuery(o, "  ")).toBe(true);
    expect(shiftMatchesQuery(o, "CAFÉ")).toBe(true);
    expect(shiftMatchesQuery(o, "bar")).toBe(true);
    expect(shiftMatchesQuery(o, "mc")).toBe(true);
    expect(shiftMatchesQuery(o, "dinner")).toBe(false);
  });
});

describe("boardSummary", () => {
  it("counts shifts with nobody, shifts short of hands and open spots", () => {
    const a = occ({ id: "a", code: "aa", capacity: 2 });
    const b = occ({ id: "b", code: "bb", capacity: 2 });
    const c = occ({ id: "c", code: "cc", capacity: 1 });
    const d = occ({ id: "d", code: "dd" }); // no capacity — never a gap
    const rs = [
      rsvp(b.address, "p1", "accepted"),
      rsvp(c.address, "p2", "accepted"),
    ];
    expect(boardSummary([a, b, c, d], rs)).toEqual({
      shifts: 4,
      unstaffed: 1,
      short: 1,
      spotsOpen: 3,
    });
  });
});

describe("mergeOccurrences", () => {
  it("replaces by address, newest wins, sorted by start", () => {
    const a = occ({
      id: "a",
      code: "aa",
      start: 2_000,
      end: 3_000,
      createdAt: 1,
    });
    const b = occ({
      id: "b",
      code: "bb",
      start: 1_000,
      end: 2_000,
      createdAt: 1,
    });
    const a2 = { ...a, id: "a2", title: "renamed", createdAt: 2 };
    const out = mergeOccurrences([a], [b, a2]);
    expect(out.map((o) => o.id)).toEqual(["b", "a2"]);
    // An older republish never regresses the wall.
    expect(mergeOccurrences([a2], [a]).map((o) => o.id)).toEqual(["a2"]);
  });
});

describe("planCoverage", () => {
  const plan: ShiftPlan = {
    tzid: "UTC",
    horizonDays: 14,
    shifts: [
      {
        code: "mc",
        title: "Morning",
        start: "08:00",
        end: "10:00",
        capacity: 2,
        enabled: true,
      },
      {
        code: "ev",
        title: "Evening",
        start: "18:00",
        end: "20:00",
        capacity: 1,
        enabled: true,
        days: [6, 7],
      },
    ],
  };
  // Tuesday 2026-09-08, 07:00Z — before the morning shift.
  const now = new Date(Date.UTC(2026, 8, 8, 7));

  it("lines the plan up against the wall over a window from today in the plan's zone", () => {
    const published = occ({
      id: "p",
      date: "2026-09-08",
      code: "mc",
      title: "Morning",
      start: localToUnix("2026-09-08", "08:00", "UTC"),
      end: localToUnix("2026-09-08", "10:00", "UTC"),
      capacity: 2,
    });
    const { items, summary, from } = planCoverage(
      plan,
      "-100",
      [published],
      [],
      { days: 7, now },
    );
    expect(from).toBe("2026-09-08");
    // 7 mornings + Sat/Sun evenings (12th, 13th).
    expect(items).toHaveLength(9);
    expect(items[0]).toMatchObject({
      key: "2026-09-08-mc",
      state: "unstaffed",
      drifted: false,
    });
    expect(items.filter((i) => i.state === "unpublished")).toHaveLength(8);
    expect(summary.unpublished).toBe(8);
    expect(summary.unstaffed).toBe(1);
    const days = groupCoverageByDay(items);
    expect(days.map((d) => d.iso)).toEqual([
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
      "2026-09-14",
    ]);
    expect(days[4].items.map((i) => i.code)).toEqual(["mc", "ev"]);
  });

  it("keeps a published shift beyond the slice out of view rather than stale", () => {
    const later = occ({
      id: "l",
      date: "2026-09-20",
      code: "mc",
      start: localToUnix("2026-09-20", "08:00", "UTC"),
      end: localToUnix("2026-09-20", "10:00", "UTC"),
      capacity: 2,
    });
    const { items, summary } = planCoverage(plan, "-100", [later], [], {
      days: 7,
      now,
    });
    expect(items.some((i) => i.state === "stale")).toBe(false);
    expect(summary.stale).toBe(0);
    expect(items).toHaveLength(9);
  });

  it("drops slots that are already over, and flags a foreign coordinator's shift only when pinned", () => {
    const late = new Date(Date.UTC(2026, 8, 8, 11)); // after this morning's shift
    const foreign = occ({
      id: "f",
      pubkey: "f".repeat(64),
      address: `31923:${"f".repeat(64)}:shift--100-2026-09-09-mc`,
      date: "2026-09-09",
      code: "mc",
      start: localToUnix("2026-09-09", "08:00", "UTC"),
      end: localToUnix("2026-09-09", "10:00", "UTC"),
      capacity: 2,
    });
    const lenient = planCoverage(plan, "-100", [foreign], [], {
      days: 2,
      now: late,
    });
    expect(lenient.items.map((i) => `${i.key}:${i.state}`)).toEqual([
      "2026-09-09-mc:unstaffed",
    ]);
    const strict = planCoverage(plan, "-100", [foreign], [], {
      days: 2,
      now: late,
      coordinatorPubkey: COORD,
    });
    expect(strict.items.map((i) => `${i.key}:${i.state}`)).toEqual([
      "2026-09-09-mc:unpublished",
    ]);
  });

  it("turns an expected slot into the publish payload", () => {
    const { items } = planCoverage(plan, "-100", [], [], { days: 1, now });
    const input = occurrenceInputOf("-100", items[0].expected!);
    expect(input).toEqual({
      groupId: "-100",
      date: "2026-09-08",
      code: "mc",
      title: "Morning",
      start: localToUnix("2026-09-08", "08:00", "UTC"),
      end: localToUnix("2026-09-08", "10:00", "UTC"),
      tzid: "UTC",
      capacity: 2,
      timeRange: "08:00–10:00",
    });
  });
});
