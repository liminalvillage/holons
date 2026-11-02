// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  filterPeople,
  focusRest,
  initialsOf,
  peopleField,
  settlePeople,
  simBounds,
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

  it("stays gathered with many hubs and people in two of them", () => {
    // One member drawn off by a second hub once widened that hub's whole
    // ground, which pushed everyone out, and 60 people flew ~400 radii apart.
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const crowd = Array.from({ length: 60 }, (_, i) => {
      const hubs = new Set([`h${Math.floor(rnd() * 8)}`]);
      if (rnd() < 0.25) hubs.add(`h${Math.floor(rnd() * 8)}`);
      return person(`${i}`, ...hubs);
    });
    const sim = settlePeople(crowd, 26);
    const box = simBounds(sim, 26);
    expect(Math.max(box.w, box.h)).toBeLessThan(40 * 26);
  });

  it("holds two cells closer the more people they share", () => {
    // Three hubs of six: a and b share three people, a and c only one.
    const cast = [
      ...["s1", "s2", "s3"].map((id) => person(id, "a", "b")),
      person("t1", "a", "c"),
      ...["a1", "a2"].map((id) => person(id, "a")),
      ...["b1", "b2", "b3"].map((id) => person(id, "b")),
      ...["c1", "c2", "c3", "c4", "c5"].map((id) => person(id, "c")),
    ];
    const sim = settlePeople(cast, 26);
    const centre = (ids: string[]) => patch(sim, ids);
    const a = centre(["s1", "s2", "s3", "t1", "a1", "a2"]);
    const b = centre(["s1", "s2", "s3", "b1", "b2", "b3"]);
    const c = centre(["t1", "c1", "c2", "c3", "c4", "c5"]);
    const ab = Math.hypot(a.x - b.x, a.y - b.y);
    const ac = Math.hypot(a.x - c.x, a.y - c.y);
    expect(ab).toBeLessThan(ac);
  });

  it("parts cells that share nobody, rather than piling them up", () => {
    const cast = ["a", "b", "c"].flatMap((h) =>
      [1, 2, 3, 4].map((i) => person(`${h}${i}`, h)),
    );
    const sim = settlePeople(cast, 26);
    const cs = ["a", "b", "c"].map((h) =>
      patch(
        sim,
        [1, 2, 3, 4].map((i) => `${h}${i}`),
      ),
    );
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++)
        expect(
          Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y),
        ).toBeGreaterThan(cs[i].reach + cs[j].reach);
  });

  it("comes to rest, and is the same picture every time", () => {
    const sim = settlePeople(people, 26);
    const field = peopleField(sim, people);
    expect(stepPeopleSim(sim, 26, { field })).toBeLessThan(0.5);
    expect(settlePeople(people, 26)).toEqual(settlePeople(people, 26));
  });

  it("comes to rest, so the view can stop drawing", () => {
    const sim = settlePeople(people, 26);
    const field = peopleField(sim, people);
    expect(stepPeopleSim(sim, 26, { field })).toBeLessThan(0.05);
  });

  it("leaves a held person to the hand while the rest move", () => {
    const sim = settlePeople(people, 26);
    const field = peopleField(sim, people);
    sim.px[0] += 200; // carried off
    const held = [sim.px[0], sim.py[0]];
    const other = [sim.px[1], sim.py[1]];
    for (let f = 0; f < 30; f++) stepPeopleSim(sim, 26, { field, held: 0 });
    expect([sim.px[0], sim.py[0]]).toEqual(held);
    expect([sim.px[1], sim.py[1]]).not.toEqual(other);
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

describe("filterPeople", () => {
  const hubs = [
    { id: "-1", name: "Casa Selva" },
    { id: "-2", name: "Liminal Village" },
    { id: "-3", name: "Oilonics" },
  ];
  const names: Record<string, string> = {
    ann: "Ann Àlvarez",
    bo: "Bo Lind",
    cy: "Cy Moss",
  };
  const nameOf = (id: string) => names[id] ?? id;
  const cast = [
    person("ann", "-1", "-2"),
    person("bo", "-2", "-3"),
    person("cy", "-3"),
  ];

  it("keeps everyone on a blank query", () => {
    const out = filterPeople(cast, hubs, "  ", nameOf);
    expect(out.people).toEqual(cast);
    expect([...out.hubs].sort()).toEqual(["-1", "-2", "-3"]);
  });

  it("finds a person by name, accents aside, with all their hubs", () => {
    const out = filterPeople(cast, hubs, "alvarez", nameOf);
    expect(out.people).toEqual([person("ann", "-1", "-2")]);
    expect([...out.hubs].sort()).toEqual(["-1", "-2"]);
  });

  it("finds a hub's members, standing only on that hub", () => {
    const out = filterPeople(cast, hubs, "liminal", nameOf);
    expect(out.people).toEqual([person("ann", "-2"), person("bo", "-2")]);
    expect([...out.hubs]).toEqual(["-2"]);
  });

  it("answers nothing when nobody and no hub matches", () => {
    const out = filterPeople(cast, hubs, "zzz", nameOf);
    expect(out.people).toEqual([]);
    expect(out.hubs.size).toBe(0);
  });
});
