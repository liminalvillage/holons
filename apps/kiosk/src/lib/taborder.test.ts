// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { applyTabOrder, mergeTabOrder, moveId } from "./taborder";

const TABS = ["tasks", "calendar", "shifts", "library", "roles"].map((id) => ({
  id,
}));
const ids = (tabs: { id: string }[]) => tabs.map((t) => t.id);

describe("applyTabOrder", () => {
  it("keeps the default order with no preference", () => {
    expect(ids(applyTabOrder(TABS, []))).toEqual(ids(TABS));
  });
  it("puts listed tabs first, in the listed order, then the rest", () => {
    expect(ids(applyTabOrder(TABS, ["roles", "calendar"]))).toEqual([
      "roles",
      "calendar",
      "tasks",
      "shifts",
      "library",
    ]);
  });
  it("ignores ids that no longer exist and repeats", () => {
    expect(ids(applyTabOrder(TABS, ["gone", "library", "library"]))).toEqual([
      "library",
      "tasks",
      "calendar",
      "shifts",
      "roles",
    ]);
  });
});

describe("mergeTabOrder", () => {
  const full = ["tasks", "calendar", "shifts", "library", "roles"];
  it("refills the visible slots in the new sequence", () => {
    // shifts hidden; the caretaker dragged roles to the front of the strip
    expect(
      mergeTabOrder(full, ["roles", "tasks", "calendar", "library"]),
    ).toEqual(["roles", "tasks", "shifts", "calendar", "library"]);
  });
  it("keeps a hidden tab where it was", () => {
    expect(
      mergeTabOrder(full, ["library", "calendar", "tasks", "roles"]),
    ).toEqual(["library", "calendar", "shifts", "tasks", "roles"]);
  });
  it("appends visible ids the full order never had", () => {
    expect(mergeTabOrder(["a", "b"], ["b", "c", "a"])).toEqual(["b", "c", "a"]);
  });
  it("is a no-op when nothing moved", () => {
    expect(mergeTabOrder(full, full)).toEqual(full);
    expect(mergeTabOrder(full, [])).toEqual(full);
  });
});

describe("moveId", () => {
  it("moves an id to the index, clamped", () => {
    expect(moveId(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
    expect(moveId(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
    expect(moveId(["a", "b", "c"], "b", 99)).toEqual(["a", "c", "b"]);
    expect(moveId(["a", "b", "c"], "b", -5)).toEqual(["b", "a", "c"]);
  });
  it("leaves the list alone for an unknown id", () => {
    expect(moveId(["a", "b"], "z", 0)).toEqual(["a", "b"]);
  });
});
