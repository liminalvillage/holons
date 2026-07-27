// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { isParticipant, personalTasks, sameId } from "./personal";
import type { BacklogTask, TaskPerson } from "./data";

function task(id: string, people: TaskPerson[] = []): BacklogTask {
  return {
    id,
    title: `Task ${id}`,
    participants: people.length,
    people,
    appreciation: 0,
    appreciatedBy: [],
    unmetDeps: 0,
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
