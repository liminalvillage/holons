// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  isParticipant,
  personalChecklists,
  personalEvents,
  personalTasks,
  personalThings,
  sameId,
} from "./personal";
import type {
  BacklogTask,
  CalendarEvent,
  ChecklistCard,
  LibraryThing,
  TaskPerson,
} from "./data";

function task(id: string, people: TaskPerson[] = []): BacklogTask {
  return {
    id,
    title: `Task ${id}`,
    participants: people.length,
    people,
    appreciation: 0,
    appreciatedBy: [],
    created: 0,
    unmetDeps: 0,
    dependencies: [],
  };
}

describe("sameId", () => {
  it("matches identical ids and across number/string", () => {
    expect(sameId(7, 7)).toBe(true);
    expect(sameId("7", "7")).toBe(true);
    expect(sameId(7, "7")).toBe(true);
    expect(sameId("7", 7)).toBe(true);
  });

  it("rejects different ids and any null/undefined side", () => {
    expect(sameId(7, 8)).toBe(false);
    expect(sameId("alice", "bob")).toBe(false);
    expect(sameId(null, 7)).toBe(false);
    expect(sameId(7, undefined)).toBe(false);
    expect(sameId(null, null)).toBe(false);
  });
});

describe("isParticipant", () => {
  it("finds the user regardless of stored id type", () => {
    const t = task("a", [{ id: "42", name: "Ann" }]);
    expect(isParticipant(t, 42)).toBe(true);
    expect(isParticipant(t, "42")).toBe(true);
  });

  it("is false for non-participants, empty people, and no user", () => {
    const t = task("a", [{ id: 1, name: "Bo" }]);
    expect(isParticipant(t, 2)).toBe(false);
    expect(isParticipant(task("b"), 1)).toBe(false);
    expect(isParticipant(t, null)).toBe(false);
    expect(isParticipant(t, undefined)).toBe(false);
  });
});

describe("personalTasks", () => {
  const mine = 235;
  const tasks = [
    task("a", [{ id: "235", name: "Me" }]),
    task("b", [{ id: 999, name: "Other" }]),
    task("c", [
      { id: 999, name: "Other" },
      { id: 235, name: "Me" },
    ]),
    task("d"),
  ];

  it("keeps only the user's tasks, preserving backlog order", () => {
    expect(personalTasks(tasks, mine).map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("returns nothing when logged out", () => {
    expect(personalTasks(tasks, null)).toEqual([]);
    expect(personalTasks(tasks, undefined)).toEqual([]);
  });

  it("handles an empty backlog", () => {
    expect(personalTasks([], mine)).toEqual([]);
  });
});

describe("personalEvents", () => {
  function event(id: string, people: TaskPerson[] = []): CalendarEvent {
    return {
      id,
      title: `Event ${id}`,
      date: new Date("2026-08-01T10:00:00Z"),
      allDay: false,
      people,
      appreciation: 0,
    };
  }
  const events = [
    event("a", [{ id: "235", name: "Me" }]),
    event("b", [{ id: 999, name: "Other" }]),
    event("c"),
  ];

  it("keeps only events the user is going to, across id types", () => {
    expect(personalEvents(events, 235).map((e) => e.id)).toEqual(["a"]);
    expect(personalEvents(events, "235").map((e) => e.id)).toEqual(["a"]);
  });

  it("returns nothing when logged out", () => {
    expect(personalEvents(events, null)).toEqual([]);
    expect(personalEvents(events, undefined)).toEqual([]);
  });
});

describe("personalThings", () => {
  function thing(
    id: string,
    available: boolean,
    borrowerId?: number | string | null,
  ): LibraryThing {
    return { id, title: `Thing ${id}`, type: "tool", available, borrowerId };
  }
  const things = [
    thing("out-with-me", false, "235"),
    thing("out-with-other", false, 999),
    thing("on-shelf", true),
    thing("out-unknown", false, null),
  ];

  it("keeps only what's out with the user, across id types", () => {
    expect(personalThings(things, 235).map((t) => t.id)).toEqual([
      "out-with-me",
    ]);
    expect(personalThings(things, "235").map((t) => t.id)).toEqual([
      "out-with-me",
    ]);
  });

  it("excludes available things even if a stale borrowerId lingers", () => {
    expect(personalThings([thing("stale", true, 235)], 235)).toEqual([]);
  });

  it("returns nothing when logged out", () => {
    expect(personalThings(things, null)).toEqual([]);
    expect(personalThings(things, undefined)).toEqual([]);
  });
});

describe("personalChecklists", () => {
  function list(
    id: string,
    creator: string | number | null,
    special = false,
  ): ChecklistCard {
    return {
      id,
      title: id.toUpperCase(),
      icon: "📋",
      done: 0,
      total: 0,
      special,
      creator,
    };
  }
  const lists = [
    list("mine", 235),
    list("mine-string", "235"),
    list("theirs", 999),
    list("orphan", null),
    list("shopping", 999, true),
  ];

  it("keeps the user's own lists plus the communal special ones", () => {
    expect(personalChecklists(lists, 235).map((c) => c.id)).toEqual([
      "mine",
      "mine-string",
      "shopping",
    ]);
    expect(personalChecklists(lists, "235").map((c) => c.id)).toEqual([
      "mine",
      "mine-string",
      "shopping",
    ]);
  });

  it("returns nothing when logged out", () => {
    expect(personalChecklists(lists, null)).toEqual([]);
    expect(personalChecklists(lists, undefined)).toEqual([]);
  });
});
