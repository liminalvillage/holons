// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { PersonAcross } from "@holons/core/holons";
import { initialsOf, personSpots, rimPoint } from "./dockpeople";

const person = (id: string, ...holons: string[]): PersonAcross => ({
  id,
  ids: [id],
  holons,
});
const at = (pairs: Record<string, [number, number]>) =>
  new Map(Object.entries(pairs).map(([k, [x, y]]) => [k, { x, y }]));

describe("personSpots", () => {
  it("stands a connector off the middle of their two hubs, upward", () => {
    const [s] = personSpots(
      [person("1", "a", "b")],
      at({ a: [0, 100], b: [400, 100] }),
      50,
      20,
    );
    expect(s.person?.id).toBe("1");
    expect(s.hubs).toEqual(["a", "b"]);
    expect(s.x).toBeCloseTo(200);
    expect(s.y).toBeCloseTo(100 - 26); // person radius + gap, no overlap to clear
  });

  it("lifts clear of two orbs too close to stand between", () => {
    const [s] = personSpots(
      [person("1", "a", "b")],
      at({ a: [0, 0], b: [60, 0] }),
      50,
      20,
    );
    expect(s.x).toBeCloseTo(30);
    expect(s.y).toBeCloseTo(-(50 + 26)); // above both orbs
  });

  it("rows up people who share the same hubs, and folds the rest", () => {
    const people = ["1", "2", "3", "4"].map((id) => person(id, "b", "a"));
    const spots = personSpots(people, at({ a: [0, 0], b: [400, 0] }), 50, 20, {
      cap: 2,
    });
    expect(spots.map((s) => s.person?.id ?? `+${s.more}`)).toEqual([
      "1",
      "2",
      "+2",
    ]);
    // Along the axis, centred on the middle, just above the line.
    expect(spots.map((s) => Math.round(s.x))).toEqual([154, 200, 246]);
    expect(spots.every((s) => Math.round(s.y) === -26)).toBe(true);
  });

  it("puts someone in three hubs in the middle of them", () => {
    const [s] = personSpots(
      [person("1", "a", "b", "c")],
      at({ a: [0, 0], b: [300, 0], c: [150, 300] }),
      50,
      20,
    );
    expect(s).toMatchObject({ x: 150, y: 100 });
  });

  it("keeps people of crossing groups off one another", () => {
    const spots = personSpots(
      [person("1", "a", "b"), person("2", "c", "d")],
      at({ a: [0, 100], b: [400, 100], c: [200, -100], d: [200, 300] }),
      50,
      20,
    );
    const [p, q] = spots;
    expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(46 - 1e-6);
  });

  it("draws nobody whose hubs are not both on screen", () => {
    const positions = at({ a: [0, 0], b: [400, 0] });
    expect(personSpots([person("1", "a", "z")], positions, 50, 20)).toEqual([]);
    expect(
      personSpots([person("1", "a", "b")], positions, 50, 20, {
        visible: new Set(["a"]),
      }),
    ).toEqual([]);
  });
});

describe("rimPoint", () => {
  it("lands on the rim facing the person", () => {
    expect(rimPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 50)).toEqual({
      x: 50,
      y: 0,
    });
  });
  it("is the centre for someone inside the orb", () => {
    expect(rimPoint({ x: 0, y: 0 }, { x: 10, y: 0 }, 50)).toEqual({
      x: 0,
      y: 0,
    });
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
