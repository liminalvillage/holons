// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The map's list view: which hubs and which lens records it lists, and in
// what order.
import { describe, expect, it } from "vitest";
import { hubRows, lensRows } from "./maplist";

describe("hubRows", () => {
  it("lists the dock in name order, each with its place when it has one", () => {
    const hexes = new Map([["-2", "8a1f"]]);
    expect(
      hubRows(
        [
          { id: "-1", name: "olive grove" },
          { id: "-2", name: "Liminal" },
          { id: "-3", name: "Hub 10" },
          { id: "-4", name: "Hub 9" },
        ],
        (id) => hexes.get(id),
      ),
    ).toEqual([
      { id: "-4", name: "Hub 9", hex: null },
      { id: "-3", name: "Hub 10", hex: null },
      { id: "-2", name: "Liminal", hex: "8a1f" },
      { id: "-1", name: "olive grove", hex: null },
    ]);
  });
});

describe("lensRows", () => {
  const held = new Map([
    [
      "cellA",
      new Map<string, Record<string, unknown>>([
        ["q2", { id: "q2", title: "Water the garden" }],
        ["q1", { id: "q1", title: "fix the roof" }],
        ["q3", { id: "q3", title: "Done already", status: "completed" }],
        ["q4", { id: "q4", title: "Gone", _deleted: true }],
      ]),
    ],
    [
      "cellB",
      new Map<string, Record<string, unknown>>([
        ["q5", { id: "q5", title: "Bake bread" }],
        // The same record, heard again in a neighbouring cell.
        ["q1", { id: "q1", title: "fix the roof" }],
      ]),
    ],
    [
      "parentOfA",
      new Map<string, Record<string, unknown>>([
        ["q2", { id: "q2", title: "Water the garden" }],
        ["q9", { id: "q9", title: "Elsewhere" }],
      ]),
    ],
  ]);

  it("lists what counts in the cells on screen, once each, by label", () => {
    const { rows, total } = lensRows("quests", held, ["cellA", "cellB"]);
    expect(rows.map((r) => [r.label, r.cell])).toEqual([
      ["Bake bread", "cellB"],
      ["fix the roof", "cellA"],
      ["Water the garden", "cellA"],
    ]);
    expect(total).toBe(3);
  });

  it("leaves out what is held for cells no longer in view", () => {
    const { rows } = lensRows("quests", held, ["cellB", "cellZ"]);
    expect(rows.map((r) => r.id)).toEqual(["q5", "q1"]);
  });

  it("keeps a completed record on a lens where it still counts", () => {
    const { rows } = lensRows("projects", held, ["cellA"]);
    expect(rows.map((r) => r.id)).toContain("q3");
  });

  it("caps the rows and still says how many there are", () => {
    const { rows, total } = lensRows("quests", held, ["cellA", "cellB"], 2);
    expect(rows).toHaveLength(2);
    expect(total).toBe(3);
  });

  it("labels a record with nothing to call it by its id, and drops junk", () => {
    const cell = new Map<string, Record<string, unknown>>([
      ["x1", { id: "x1", when: "soon" }],
      ["junk", { when: "never" }],
    ]);
    const { rows } = lensRows("events", new Map([["c", cell]]), ["c"]);
    expect(rows.map((r) => [r.id, r.label])).toEqual([["x1", "x1"]]);
  });
});
