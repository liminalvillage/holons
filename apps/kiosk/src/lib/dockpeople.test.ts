// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  focusRest,
  initialsOf,
  peopleField,
  settlePeople,
  simBounds,
  spanTree,
  stepPeopleSim,
  syncPeopleSim,
  type PeopleSim,
} from "./dockpeople";

const person = (id: string, ...holons: string[]) => ({ id, holons });
const dist = (sim: PeopleSim, a: string, b: string) => {
  const i = sim.ids.indexOf(a);
  const j = sim.ids.indexOf(b);
  return Math.hypot(sim.px[i] - sim.px[j], sim.py[i] - sim.py[j]);
};
/** The middle of some people, and how far the farthest of them is from it. */
const patch = (sim: PeopleSim, ids: string[]) => {
  const at = ids.map((id) => sim.ids.indexOf(id));
  const x = at.reduce((s, i) => s + sim.px[i], 0) / at.length;
  const y = at.reduce((s, i) => s + sim.py[i], 0) / at.length;
  const reach = Math.max(
    ...at.map((i) => Math.hypot(sim.px[i] - x, sim.py[i] - y)),
  );
  return { x, y, reach };
};

describe("the people field", () => {
  // Two hubs of five, and one person in both.
  const as = ["a1", "a2", "a3", "a4", "a5"];
  const bs = ["b1", "b2", "b3", "b4", "b5"];
  const people = [
    person("both", "a", "b"),
    ...as.map((id) => person(id, "a")),
    ...bs.map((id) => person(id, "b")),
    person("far", "z"),
  ];

  it("gives each hub its own ground, apart from the other's", () => {
    const sim = settlePeople(people, 26);
    const a = patch(sim, as);
    const b = patch(sim, bs);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(
      Math.max(a.reach, b.reach),
    );
  });

  it("stands whoever is in two hubs between them", () => {
    const sim = settlePeople(people, 26);
    const a = patch(sim, as);
    const b = patch(sim, bs);
    const i = sim.ids.indexOf("both");
    const gap = Math.hypot(a.x - b.x, a.y - b.y);
    expect(Math.hypot(sim.px[i] - a.x, sim.py[i] - a.y)).toBeLessThan(gap);
    expect(Math.hypot(sim.px[i] - b.x, sim.py[i] - b.y)).toBeLessThan(gap);
  });

  it("keeps a stranger off a hub's ground", () => {
    const sim = settlePeople(people, 26);
    const a = patch(sim, ["both", ...as]);
    const i = sim.ids.indexOf("far");
    expect(Math.hypot(sim.px[i] - a.x, sim.py[i] - a.y)).toBeGreaterThan(
      a.reach + 26,
    );
  });

  it("never stands one person on another, however big the hub", () => {
    const crowd = Array.from({ length: 40 }, (_, i) => person(`${i}`, "a"));
    const sim = settlePeople(crowd, 26);
    for (let i = 0; i < 40; i++)
      for (let j = i + 1; j < 40; j++)
        expect(dist(sim, `${i}`, `${j}`)).toBeGreaterThan(48);
  });

  it("comes to rest, and is the same picture every time", () => {
    const sim = settlePeople(people, 26);
    const field = peopleField(sim, people);
    expect(stepPeopleSim(sim, 26, { field })).toBeLessThan(0.5);
    expect(settlePeople(people, 26)).toEqual(settlePeople(people, 26));
  });

  it("keeps wandering when asked to, and leaves a held person to the hand", () => {
    const sim = settlePeople(people, 26);
    const before = [sim.px[0], sim.py[0], sim.px[1], sim.py[1]];
    for (let f = 0; f < 30; f++)
      stepPeopleSim(sim, 26, { wobbleT: f * 16, held: 0 });
    expect([sim.px[0], sim.py[0]]).toEqual(before.slice(0, 2));
    expect([sim.px[1], sim.py[1]]).not.toEqual(before.slice(2));
  });

  it("gathers round the person in focus, the most shared nearest", () => {
    const cast = [
      person("me", "a", "b", "c"),
      person("three", "a", "b", "c"),
      person("one", "a"),
      person("none", "z"),
    ];
    const sim = settlePeople(cast, 26);
    const field = peopleField(sim, cast);
    const me = [sim.px[0], sim.py[0]];
    for (let f = 0; f < 300; f++) stepPeopleSim(sim, 26, { field, focus: 0 });
    expect([sim.px[0], sim.py[0]]).toEqual(me); // the focus stays put
    expect(dist(sim, "me", "three")).toBeLessThan(dist(sim, "me", "one"));
    expect(dist(sim, "me", "one")).toBeLessThan(dist(sim, "me", "none"));
    expect(focusRest(3)).toBeLessThan(focusRest(1));
  });

  it("keeps everyone in place when the cast changes around them", () => {
    const sim = settlePeople(people, 26);
    const next = syncPeopleSim(sim, ["a1", "new", "both"], 26);
    expect(next.ids).toEqual(["a1", "new", "both"]);
    expect([next.px[0], next.py[0]]).toEqual([sim.px[1], sim.py[1]]);
    expect([next.px[2], next.py[2]]).toEqual([sim.px[0], sim.py[0]]);
  });

  it("reads who shares what off the people it holds", () => {
    const cast = [
      person("1", "a", "b"),
      person("2", "b", "a"),
      person("3", "a"),
    ];
    const sim = syncPeopleSim(null, ["1", "2", "3"], 26);
    const field = peopleField(sim, cast);
    expect(field.hubIds).toEqual(["a", "b"]);
    expect(field.hubs).toEqual([
      [0, 1, 2],
      [0, 1],
    ]);
    expect([field.kin[1], field.kin[2], field.kin[5]]).toEqual([2, 1, 1]);
    expect([...field.count]).toEqual([2, 2, 1]);
  });

  it("bounds the orbs it holds", () => {
    const sim = syncPeopleSim(null, ["1", "2"], 26);
    sim.px.set([0, 100]);
    sim.py.set([0, 0]);
    expect(simBounds(sim, 26)).toEqual({ x: 50, y: 0, w: 152, h: 52 });
    expect(simBounds(syncPeopleSim(null, [], 26), 26).w).toBe(0);
  });
});

describe("spanTree", () => {
  it("joins every point with the shortest lines, and no more", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 10, y: 0 },
      { x: 100, y: 10 },
    ];
    const tree = spanTree(pts);
    expect(tree).toHaveLength(3);
    const key = (e: [number, number]) => [...e].sort().join("-");
    expect(tree.map(key).sort()).toEqual(["0-2", "1-2", "1-3"]);
    expect(spanTree([pts[0]])).toEqual([]);
    expect(spanTree([])).toEqual([]);
  });
});

describe("initialsOf", () => {
  it("takes the first and last word", () => {
    expect(initialsOf("Ada Lovelace")).toBe("AL");
    expect(initialsOf("ada")).toBe("A");
    expect(initialsOf("Élise de la Tour")).toBe("ÉT");
  });
  it("has nothing to say for an id", () => {
    expect(initialsOf("#235114395")).toBe("");
    expect(initialsOf("")).toBe("");
  });
});
