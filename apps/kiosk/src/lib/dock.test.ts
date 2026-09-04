// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  beaconPath,
  beaconTangents,
  boundsPath,
  convexHull,
  hueFor,
  labelFor,
  lensPath,
  linksAmong,
  orbClusters,
  LINK_MAX_GAP,
  orbLayout,
  orbPositions,
  orbUnder,
  parseDock,
  removeEntry,
  seedOrbs,
  segmentFor,
  stepOrbs,
  syncOrbs,
  renameEntry,
  upsertEntry,
  type DockEntry,
} from "./dock";

const entry = (id: string, name = "", at = 1): DockEntry => ({ id, name, at });

describe("parseDock", () => {
  it("returns [] for null, junk, and non-arrays", () => {
    expect(parseDock(null)).toEqual([]);
    expect(parseDock("not json")).toEqual([]);
    expect(parseDock('{"id":"x"}')).toEqual([]);
  });

  it("keeps well-formed entries and drops malformed ones", () => {
    const raw = JSON.stringify([
      { id: "-1003864542239", name: "Liminal", at: 5 },
      { id: "", name: "empty id", at: 5 },
      { id: "-100", name: 42, at: 5 },
      { name: "no id", at: 5 },
      null,
    ]);
    expect(parseDock(raw)).toEqual([
      { id: "-1003864542239", name: "Liminal", at: 5 },
    ]);
  });
});

describe("upsertEntry", () => {
  it("appends a new board at the end (stable circle positions)", () => {
    const list = [entry("-1", "One")];
    const next = upsertEntry(list, "-2", "Two", 9);
    expect(next.map((e) => e.id)).toEqual(["-1", "-2"]);
    expect(next[1]).toEqual({ id: "-2", name: "Two", at: 9 });
  });

  it("updates an existing board in place, keeping its position", () => {
    const list = [entry("-1", "One"), entry("-2", "Two")];
    const next = upsertEntry(list, "-1", "One renamed", 9);
    expect(next.map((e) => e.id)).toEqual(["-1", "-2"]);
    expect(next[0]).toEqual({ id: "-1", name: "One renamed", at: 9 });
  });

  it("never clobbers a learned name with an empty one", () => {
    const next = upsertEntry([entry("-1", "One")], "-1", "  ", 9);
    expect(next[0].name).toBe("One");
  });

  it("returns the same reference when nothing changes", () => {
    const list = [entry("-1", "One", 7)];
    expect(upsertEntry(list, "-1", "One", 7)).toBe(list);
  });

  it("falls back to the registered label, then the id, for a new nameless board", () => {
    expect(upsertEntry([], "-1003864542239", "")[0].name).toBe("Liminal");
    expect(upsertEntry([], "-42", "")[0].name).toBe("-42");
  });
});

describe("renameEntry", () => {
  it("sets a resolved name", () => {
    const list = [entry("-1", "-1")];
    expect(renameEntry(list, "-1", "Liminal Village")[0].name).toBe(
      "Liminal Village",
    );
  });

  it("falls back to the id/label when the holon resolves no name", () => {
    expect(renameEntry([entry("-42", "Borrowed")], "-42", "")[0].name).toBe(
      "-42",
    );
    const known = renameEntry(
      [entry("-1003864542239", "Borrowed")],
      "-1003864542239",
      "  ",
    );
    expect(known[0].name).toBe("Liminal");
  });

  it("keeps `at` and the list identity when nothing changes", () => {
    const list = [entry("-1", "One", 7)];
    expect(renameEntry(list, "-1", "One")).toBe(list);
    expect(renameEntry(list, "-1", "Two")[0].at).toBe(7);
  });

  it("is a no-op for a board that isn't docked", () => {
    const list = [entry("-1", "One")];
    expect(renameEntry(list, "-2", "Two")).toBe(list);
  });
});

describe("removeEntry", () => {
  it("removes the board and only that board", () => {
    const list = [entry("-1"), entry("-2")];
    expect(removeEntry(list, "-1").map((e) => e.id)).toEqual(["-2"]);
  });

  it("returns the same reference when the board isn't listed", () => {
    const list = [entry("-1")];
    expect(removeEntry(list, "-9")).toBe(list);
  });
});

describe("labelFor / segmentFor", () => {
  it("resolves a registered holon to its label", () => {
    expect(segmentFor("-1003864542239")).toBe("liminal");
    expect(labelFor("-1003864542239")).toBe("Liminal");
  });

  it("falls back to the raw id for unregistered holons", () => {
    expect(segmentFor("-1009999999999")).toBe("-1009999999999");
    expect(labelFor("-1009999999999")).toBe("-1009999999999");
  });
});

describe("linksAmong", () => {
  const partners = new Map<string, string[]>([
    ["-1", ["-2", "-9"]], // -9 is not docked → no link
    ["-2", []],
    ["-3", ["-1"]],
  ]);

  it("links a pair when either side lists the other, deduped and sorted", () => {
    const links = linksAmong(["-1", "-2", "-3"], partners);
    expect(links).toEqual([
      ["-1", "-2"],
      ["-1", "-3"],
    ]);
  });

  it("ignores partners that are not on the dock and self-links", () => {
    expect(linksAmong(["-1"], new Map([["-1", ["-1", "-9"]]]))).toEqual([]);
  });
});

describe("orbClusters", () => {
  it("groups linked boards and keeps loners as singletons", () => {
    const clusters = orbClusters(
      ["-1", "-2", "-3", "-4"],
      [
        ["-1", "-2"],
        ["-2", "-3"],
      ],
    );
    expect(clusters.map((c) => [...c].sort())).toEqual([
      ["-1", "-2", "-3"],
      ["-4"],
    ]);
  });
});

describe("orbUnder (what a drop lands on)", () => {
  const r = 50;
  const positions = new Map([
    ["-1", { x: 100, y: 100 }],
    ["-2", { x: 220, y: 100 }],
  ]);

  it("matches only when the pointer is inside the orb", () => {
    expect(orbUnder(positions, { x: 210, y: 100 }, "-1", r)).toBe("-2");
    expect(orbUnder(positions, { x: 165, y: 100 }, "-1", r)).toBe(null);
  });

  it("never matches the carried orb itself", () => {
    expect(orbUnder(positions, { x: 100, y: 100 }, "-1", r)).toBe(null);
  });

  it("ignores a federated partner towed along at the link's full reach", () => {
    // linkOverlap holds a partner within LINK_MAX_GAP radii of the carried
    // orb for the whole drag. At that reach the finger is over the ground,
    // so the drop must fall through to the hexagon beneath it.
    const towed = new Map([
      ["-1", { x: 100, y: 100 }],
      ["-2", { x: 100 + r * LINK_MAX_GAP, y: 100 }],
    ]);
    expect(orbUnder(towed, { x: 100, y: 100 }, "-1", r)).toBe(null);
    // A capture radius as wide as the leash matched it on every frame — the
    // drop that could never land on the ground.
    expect(orbUnder(towed, { x: 100, y: 100 }, "-1", 2 * r)).toBe("-2");
  });

  it("picks the nearest of two overlapping candidates", () => {
    const tight = new Map([
      ["-2", { x: 120, y: 100 }],
      ["-3", { x: 140, y: 100 }],
    ]);
    expect(orbUnder(tight, { x: 135, y: 100 }, "-1", r)).toBe("-3");
  });
});

describe("orbLayout", () => {
  const ids = ["-1", "-2", "-3", "-4"];
  const links: Array<[string, string]> = [["-1", "-2"]];

  it("keeps every orb inside the field", () => {
    const pos = orbLayout(ids, links, 800, 500, 50);
    for (const id of ids) {
      const p = pos.get(id)!;
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(800);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(500);
    }
  });

  it("pulls a federated pair closer than unlinked orbs", () => {
    const pos = orbLayout(ids, links, 800, 500, 50);
    const d = (a: string, b: string) =>
      Math.hypot(pos.get(a)!.x - pos.get(b)!.x, pos.get(a)!.y - pos.get(b)!.y);
    expect(d("-1", "-2")).toBeLessThan(d("-3", "-4"));
    expect(d("-1", "-2")).toBeLessThan(d("-1", "-3"));
  });

  it("settles a federated pair overlapping by ~25% of the diameter", () => {
    const r = 52;
    const pos = orbLayout(["-1", "-2"], [["-1", "-2"]], 900, 560, r);
    const d = Math.hypot(
      pos.get("-1")!.x - pos.get("-2")!.x,
      pos.get("-1")!.y - pos.get("-2")!.y,
    );
    const overlap = (2 * r - d) / (2 * r);
    expect(overlap).toBeGreaterThan(0.2);
    expect(overlap).toBeLessThan(0.3);
  });

  it("is deterministic and safe on empty/degenerate input", () => {
    expect(orbLayout(ids, links, 800, 500, 50)).toEqual(
      orbLayout(ids, links, 800, 500, 50),
    );
    expect(orbLayout([], [], 800, 500, 50).size).toBe(0);
    expect(orbLayout(ids, links, 0, 0, 50).size).toBe(0);
    const single = orbLayout(["-1"], [], 400, 300, 50).get("-1")!;
    expect(single.x).toBeCloseTo(200);
    expect(single.y).toBeCloseTo(150);
  });
});

describe("stepOrbs / syncOrbs (the live sky)", () => {
  const ids = ["-1", "-2", "-3"];
  const links: Array<[string, string]> = [["-1", "-2"]];

  it("keeps drifting after settling when the wander is on", () => {
    const sim = seedOrbs(ids, 800, 500);
    for (let i = 0; i < 300; i++) stepOrbs(sim, links, 800, 500, 50);
    const settled = orbPositions(sim);
    for (let i = 0; i < 60; i++)
      stepOrbs(sim, links, 800, 500, 50, 4000 + i * 16);
    const later = orbPositions(sim);
    const moved = ids.some(
      (id) =>
        Math.hypot(
          settled.get(id)!.x - later.get(id)!.x,
          settled.get(id)!.y - later.get(id)!.y,
        ) > 0.5,
    );
    expect(moved).toBe(true);
  });

  it("wander never pushes an orb out of the field", () => {
    const sim = seedOrbs(ids, 800, 500);
    for (let i = 0; i < 900; i++) stepOrbs(sim, links, 800, 500, 50, i * 16);
    for (const p of orbPositions(sim).values()) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(800);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(500);
    }
  });

  it("a lifted orb exerts and feels no forces", () => {
    const sim = seedOrbs(["a", "b"], 800, 500);
    // b parked at the field centre (zero gravity), a right beside it.
    sim.px[0] = 390;
    sim.py[0] = 250;
    sim.px[1] = 400;
    sim.py[1] = 250;
    stepOrbs(sim, [], 800, 500, 50, undefined, "a");
    expect(sim.px[1]).toBeCloseTo(400); // untouched: no shove from "a"
    expect(sim.px[0]).toBeCloseTo(390); // not integrated: the caller pins it
    stepOrbs(sim, [], 800, 500, 50);
    expect(sim.px[1]).toBeGreaterThan(400); // grounded again → repulsion is back
  });

  it("syncOrbs keeps a retained orb's position and momentum, seeds newcomers", () => {
    const sim = seedOrbs(ids, 800, 500);
    for (let i = 0; i < 50; i++) stepOrbs(sim, links, 800, 500, 50);
    const before = orbPositions(sim);
    const next = syncOrbs(sim, ["-2", "-4"], 800, 500);
    const kept = orbPositions(next).get("-2")!;
    expect(kept.x).toBeCloseTo(before.get("-2")!.x);
    expect(kept.y).toBeCloseTo(before.get("-2")!.y);
    expect(next.ids).toEqual(["-2", "-4"]);
    expect(orbPositions(next).get("-4")).toBeDefined();
  });
});

describe("convexHull / boundsPath", () => {
  it("hulls a square with an interior point down to the corners", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 },
    ]);
    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual({ x: 5, y: 5 });
  });

  it("draws a closed smooth path around any cluster, pairs included", () => {
    const two = boundsPath(
      [
        { x: 100, y: 100 },
        { x: 260, y: 140 },
      ],
      60,
    );
    expect(two).toMatch(/^M /);
    expect(two).toContain(" Q ");
    expect(two).toMatch(/Z$/);
    expect(boundsPath([{ x: 50, y: 50 }], 40)).toMatch(/^M .* Z$/);
    expect(boundsPath([], 40)).toBe("");
  });
});

describe("lensPath", () => {
  it("draws the vesica of two overlapping circles", () => {
    const d = lensPath({ x: 100, y: 100 }, { x: 178, y: 100 }, 52);
    expect(d).toMatch(/^M .* A 52 52 .* A 52 52 .* Z$/);
  });

  it("is empty when the circles are apart or concentric", () => {
    expect(lensPath({ x: 0, y: 0 }, { x: 200, y: 0 }, 52)).toBe("");
    expect(lensPath({ x: 0, y: 0 }, { x: 104, y: 0 }, 52)).toBe(""); // touching
    expect(lensPath({ x: 5, y: 5 }, { x: 5, y: 5 }, 52)).toBe("");
  });
});

describe("hueFor", () => {
  it("is deterministic and in range", () => {
    const a = hueFor("-1003864542239");
    expect(a).toBe(hueFor("-1003864542239"));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(360);
  });

  it("separates different ids (spot check)", () => {
    expect(hueFor("-1003864542239")).not.toBe(hueFor("-1001652773351"));
  });
});

describe("anchors (the earth beneath the sky)", () => {
  const r = 50;
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  it("settles a lone anchored orb on its anchor", () => {
    const anchors = new Map([["-1", { x: 600, y: 120 }]]);
    const p = orbLayout(["-1"], [], 800, 500, r, anchors).get("-1")!;
    expect(p.x).toBeCloseTo(600, 0);
    expect(p.y).toBeCloseTo(120, 0);
  });

  it("keeps an orb inside the field when its anchor is off-screen", () => {
    const anchors = new Map([["-1", { x: 1400, y: -300 }]]);
    const p = orbLayout(["-1"], [], 800, 500, r, anchors).get("-1")!;
    // Clamped to the pad (1.3 radii) on the edge nearest the place.
    expect(p.x).toBeCloseTo(800 - r * 1.3, 5);
    expect(p.y).toBeCloseTo(r * 1.3, 5);
  });

  it("keeps two placed orbs overlapping, each leaning toward its own place", () => {
    const anchors = new Map([
      ["-1", { x: 200, y: 200 }],
      ["-2", { x: 600, y: 200 }],
    ]);
    const pos = orbLayout(["-1", "-2"], [["-1", "-2"]], 800, 500, r, anchors);
    // Federated means overlapping — the places bend, the beacons still point
    // home (each orb sits on its own side of the pair).
    expect(dist(pos.get("-1")!, pos.get("-2")!)).toBeLessThanOrEqual(
      r * LINK_MAX_GAP + 0.5,
    );
    expect(pos.get("-1")!.x).toBeLessThan(pos.get("-2")!.x);
    expect(lensPath(pos.get("-1")!, pos.get("-2")!, r)).not.toBe("");
  });

  it("a spring with one free end pulls that partner alongside", () => {
    const anchors = new Map([["-1", { x: 600, y: 150 }]]);
    const pos = orbLayout(["-1", "-2"], [["-1", "-2"]], 800, 500, r, anchors);
    expect(dist(pos.get("-1")!, { x: 600, y: 150 })).toBeLessThan(6);
    expect(dist(pos.get("-1")!, pos.get("-2")!)).toBeLessThan(2 * r);
  });

  it("an anchored orb still stands off an unplaced neighbour", () => {
    const anchors = new Map([["-1", { x: 400, y: 250 }]]);
    const pos = orbLayout(["-1", "-2"], [], 800, 500, r, anchors);
    expect(dist(pos.get("-1")!, { x: 400, y: 250 })).toBeLessThan(2 * r);
    expect(dist(pos.get("-1")!, pos.get("-2")!)).toBeGreaterThan(2 * r);
  });

  it("spreads orbs parked at the edge by far-away places", () => {
    // The pull toward a place grows with the distance to it, so a place far
    // enough outside the view slams its orb into the boundary with a force no
    // repulsion can answer. Several such places drove every one of their orbs
    // onto the SAME pixel, and only the top of the pile could be tapped.
    const far = new Map([
      ["-1", { x: 9000, y: 9000 }],
      ["-2", { x: 12000, y: 9000 }],
      ["-3", { x: 15000, y: 9000 }],
    ]);
    const corner = new Map([
      ["-1", { x: 1900, y: -400 }],
      ["-2", { x: 2400, y: -900 }],
      ["-3", { x: 3100, y: -1500 }],
    ]);
    for (const anchors of [far, corner]) {
      const ids = ["-1", "-2", "-3"];
      const pos = orbLayout(ids, [], 800, 500, r, anchors);
      const pts = ids.map((id) => pos.get(id)!);
      for (const p of pts) {
        expect(p.x).toBeGreaterThanOrEqual(r * 1.3 - 0.5);
        expect(p.x).toBeLessThanOrEqual(800 - r * 1.3 + 0.5);
      }
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++)
          expect(dist(pts[i], pts[j])).toBeGreaterThan(2 * r);
    }
  });

  it("is deterministic with anchors", () => {
    const anchors = new Map([["-2", { x: 100, y: 400 }]]);
    expect(orbLayout(["-1", "-2", "-3"], [], 800, 500, r, anchors)).toEqual(
      orbLayout(["-1", "-2", "-3"], [], 800, 500, r, anchors),
    );
  });

  it("holds every link of a placed hub overlapping", () => {
    const ids = ["-1", "-2", "-3", "-4"];
    const links: [string, string][] = [
      ["-1", "-2"],
      ["-1", "-3"],
      ["-1", "-4"],
    ];
    const anchors = new Map([
      ["-1", { x: 400, y: 250 }],
      ["-2", { x: 80, y: 80 }],
      ["-3", { x: 720, y: 420 }],
    ]);
    const pos = orbLayout(ids, links, 800, 500, r, anchors);
    for (const [a, b] of links)
      expect(dist(pos.get(a)!, pos.get(b)!)).toBeLessThanOrEqual(
        r * LINK_MAX_GAP + 0.5,
      );
  });

  it("never moves the lifted orb to close a gap — the partner comes to it", () => {
    const sim = seedOrbs(["-1", "-2"], 800, 500);
    sim.px[0] = 100;
    sim.py[0] = 100;
    sim.px[1] = 700;
    sim.py[1] = 420;
    for (let i = 0; i < 200; i++)
      stepOrbs(sim, [["-1", "-2"]], 800, 500, r, undefined, "-1");
    expect(sim.px[0]).toBe(100);
    expect(sim.py[0]).toBe(100);
    expect(Math.hypot(sim.px[1] - 100, sim.py[1] - 100)).toBeLessThanOrEqual(
      r * LINK_MAX_GAP + 0.5,
    );
  });

  it("a lifted orb ignores its anchor", () => {
    const sim = seedOrbs(["-1"], 800, 500);
    const before = { x: sim.px[0], y: sim.py[0] };
    const anchors = new Map([["-1", { x: 700, y: 50 }]]);
    for (let i = 0; i < 50; i++)
      stepOrbs(sim, [], 800, 500, r, undefined, "-1", anchors);
    expect(sim.px[0]).toBe(before.x);
    expect(sim.py[0]).toBe(before.y);
  });
});

describe("beaconPath", () => {
  const nums = (d: string) =>
    d.replace(/[MLZ]/g, " ").trim().split(/\s+/).map(Number);

  it("touches the orb at two tangent points and lands on the ground", () => {
    const orb = { x: 300, y: 200 };
    const ground = { x: 420, y: 480 };
    const [x1, y1, gx, gy, x2, y2] = nums(beaconPath(orb, ground, 52));
    expect(Math.hypot(x1 - orb.x, y1 - orb.y)).toBeCloseTo(52, 0);
    expect(Math.hypot(x2 - orb.x, y2 - orb.y)).toBeCloseTo(52, 0);
    expect(gx).toBe(420);
    expect(gy).toBe(480);
    // A tangent is perpendicular to its radius.
    const dot = (x1 - orb.x) * (x1 - ground.x) + (y1 - orb.y) * (y1 - ground.y);
    expect(Math.abs(dot)).toBeLessThan(52 * 0.5);
  });

  it("is symmetric about the orb → ground line, in any direction", () => {
    for (const ground of [
      { x: 300, y: 600 },
      { x: 300, y: -100 },
      { x: 20, y: 200 },
    ]) {
      const orb = { x: 300, y: 200 };
      const [x1, y1, , , x2, y2] = nums(beaconPath(orb, ground, 40));
      const mx = (x1 + x2) / 2 - orb.x;
      const my = (y1 + y2) / 2 - orb.y;
      const cross = mx * (ground.y - orb.y) - my * (ground.x - orb.x);
      expect(Math.abs(cross)).toBeLessThan(40);
    }
  });

  it("hangs from the same two shoulders beaconTangents reports", () => {
    const orb = { x: 300, y: 200 };
    const ground = { x: 420, y: 480 };
    const [t1, t2] = beaconTangents(orb, ground, 52)!;
    const [x1, y1, , , x2, y2] = nums(beaconPath(orb, ground, 52));
    expect([x1, y1, x2, y2]).toEqual([t1.x, t1.y, t2.x, t2.y]);
    expect(beaconTangents(orb, { x: 310, y: 210 }, 52)).toBeNull();
  });

  it("is empty when the ground is under the orb or the radius is off", () => {
    const orb = { x: 100, y: 100 };
    expect(beaconPath(orb, { x: 110, y: 120 }, 50)).toBe("");
    expect(beaconPath(orb, { x: 100, y: 100 }, 50)).toBe("");
    expect(beaconPath(orb, { x: 150, y: 100 }, 50)).toBe("");
    expect(beaconPath(orb, { x: 400, y: 100 }, 0)).toBe("");
  });
});
