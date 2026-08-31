// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pure view-model helpers of the Shifts board — grouping, capacity and
// matching. The protocol itself (parsing, RSVP resolution) is covered in
// @holons/core/shifts; these specs only cover what the kiosk adds on top.

import { describe, expect, it } from "vitest";
import type { ShiftOccurrence, ShiftRsvp } from "@holons/core/shifts";
import {
  groupShiftsByDay,
  isRunningNow,
  mergeRsvps,
  shiftMatchesQuery,
  spotsLeft,
  upcomingShifts,
} from "./shifts";

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
