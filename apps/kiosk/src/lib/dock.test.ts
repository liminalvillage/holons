// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  boundsPath,
  convexHull,
  hueFor,
  labelFor,
  lensPath,
  linksAmong,
  orbClusters,
  orbLayout,
  orbPositions,
  parseDock,
  removeEntry,
  seedOrbs,
  segmentFor,
  stepOrbs,
  syncOrbs,
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
