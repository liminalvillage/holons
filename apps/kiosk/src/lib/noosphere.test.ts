// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  DOUBLE_MS,
  FRAME,
  MAX_CHILDREN,
  ROOT,
  ROOT_ROT,
  SQ3,
  channel,
  clipSeg,
  linesPath,
  childRot,
  childrenOf,
  cubeLines,
  easeInOut,
  fitLabel,
  flowerCentres,
  flowerOf,
  hexRing,
  idTail,
  latticeLines,
  lensesReaching,
  lerpCam,
  nest,
  orderKids,
  parseTrail,
  placeCard,
  reaching,
  ringPick,
  ringsFor,
  segAt,
  shortName,
  snapRot,
  spacing,
  streamOf,
  tapMeaning,
  ties,
  travel,
  twins,
  vesicaPath,
  wheelGate,
  wrapWords,
  type Measure,
  type WheelState,
  MARK,
  MARK_BOX_H,
  MARK_BOX_W,
  MARK_DROP,
  MARK_RISE,
  MARK_ALONE,
  MARK_NAME_MIN,
  markPlace,
} from "./noosphere";
import type { LensDirections } from "./dock";

const TAU = Math.PI * 2;
const SIXTH = Math.PI / 3;
const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => `p${String(i).padStart(2, "0")}`);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);
/** A face where every character is 0.55 em wide. */
const mono: Measure = (s) => s.length * 0.55;

describe("the lattice", () => {
  it("opens rings of 6, 12, 18 and 24", () => {
    expect(ringsFor(0)).toBe(0);
    expect(ringsFor(1)).toBe(1);
    expect(ringsFor(6)).toBe(1);
    expect(ringsFor(7)).toBe(2);
    expect(ringsFor(18)).toBe(2);
    expect(ringsFor(19)).toBe(3);
    expect(ringsFor(36)).toBe(3);
    expect(ringsFor(37)).toBe(4);
    expect(ringsFor(MAX_CHILDREN)).toBe(4);
    for (let m = 1; m <= 4; m++) expect(hexRing(m, 0)).toHaveLength(6 * m);
  });

  it("lays ring m on a hexagon: corners at m, sides between", () => {
    for (let m = 1; m <= 3; m++) {
      const ring = hexRing(m, 0.3);
      ring.forEach((p, i) => {
        const r = Math.hypot(p.x, p.y);
        if (i % m === 0) expect(r).toBeCloseTo(m);
        else {
          expect(r).toBeLessThan(m);
          expect(r).toBeGreaterThanOrEqual((m * SQ3) / 2 - 1e-9);
        }
      });
      // Each node is a lattice step from the next.
      ring.forEach((p, i) =>
        expect(dist(p, ring[(i + 1) % ring.length])).toBeCloseTo(1),
      );
    }
  });

  it("starts at the turn and runs clockwise", () => {
    for (const rot of [0, ROOT_ROT, 2 * SIXTH, -Math.PI]) {
      const ring = hexRing(1, rot);
      expect(ring[0].x).toBeCloseTo(Math.cos(rot));
      expect(ring[0].y).toBeCloseTo(Math.sin(rot));
      const a1 = Math.atan2(ring[1].y, ring[1].x);
      // The next one is 60° further on screen (y down: clockwise).
      const step = (((a1 - rot) % TAU) + TAU) % TAU;
      expect(step).toBeCloseTo(SIXTH);
    }
  });

  it("snaps turns to the lattice's 60°", () => {
    expect(snapRot(0.1)).toBe(0);
    expect(snapRot(SIXTH + 0.2)).toBeCloseTo(SIXTH);
    expect(snapRot(Math.PI)).toBeCloseTo(Math.PI);
    expect(snapRot(-Math.PI + 0.05)).toBeCloseTo(Math.PI);
    expect(snapRot(ROOT_ROT)).toBeCloseTo(ROOT_ROT);
  });
});

describe("ringPick", () => {
  it("spreads a part first ring evenly, in order", () => {
    expect(ringPick(1, 6)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(ringPick(1, 3)).toEqual([0, 2, 4]);
    expect(ringPick(1, 2)).toEqual([0, 3]);
    expect(ringPick(1, 1)).toEqual([0]);
  });

  it("fills an outer ring's clear nodes before its corners", () => {
    const six = ringPick(2, 6);
    expect(six).toHaveLength(6);
    for (const i of six) expect(i % 2).toBe(1);
    const eight = ringPick(2, 8);
    expect(eight).toHaveLength(8);
    expect(eight.filter((i) => i % 2 === 0)).toHaveLength(2);
    expect(new Set(ringPick(3, 17)).size).toBe(17);
  });
});

describe("flowerOf", () => {
  it("is empty for nothing", () => {
    expect(flowerOf([], 0).blooms).toEqual([]);
  });

  it.each([1, 3, 6, 7, 12, 18, 25, 36, MAX_CHILDREN])(
    "keeps %i circles apart, inside the rim, clear of the seed",
    (n) => {
      for (const shape of [FRAME, ROOT]) {
        const f = flowerOf(ids(n), ROOT_ROT, shape);
        expect(f.blooms).toHaveLength(n);
        expect(f.d).toBeCloseTo(spacing(ringsFor(n), shape));
        for (const b of f.blooms) {
          expect(Math.hypot(b.x, b.y) + b.r).toBeLessThanOrEqual(1);
          expect(Math.hypot(b.x, b.y) - b.r).toBeGreaterThan(f.hub);
        }
        for (let i = 0; i < n; i++)
          for (let j = i + 1; j < n; j++)
            expect(dist(f.blooms[i], f.blooms[j])).toBeGreaterThan(
              f.blooms[i].r * 2,
            );
      }
    },
  );

  it("leaves room for a channel between the seed and the first ring", () => {
    const f = flowerOf(ids(4), 0);
    const gap = f.d - f.hub - f.blooms[0].r;
    expect(gap).toBeGreaterThan(f.d * 0.3);
  });

  it("puts the first circle at the turn", () => {
    const f = flowerOf(["a", "b"], ROOT_ROT);
    expect(Math.atan2(f.blooms[0].y, f.blooms[0].x)).toBeCloseTo(ROOT_ROT);
  });

  it("is deterministic: the same circles are the same flower", () => {
    expect(flowerOf(ids(9), 1)).toEqual(flowerOf(ids(9), 1));
  });

  it("lays a partner out the same seen from outside and from inside", () => {
    // Seen from `a`, the preview in b's circle is flowerOf(b's circles in
    // order, childRot(b's slot)); entered, the trail keeps that turn and the
    // frame is drawn by the same call — the flight lands on it.
    const outer = flowerOf(
      orderKids(["b", "c", "d"], null, () => 0),
      0,
    );
    const b = outer.blooms.find((x) => x.id === "b")!;
    const kids = orderKids(childrenOf("b", ["c", "e", "f"], "a"), "a", () => 0);
    const preview = flowerOf(kids, childRot(b));
    const step = travel([], "b", childRot(b));
    const inside = flowerOf(kids, step[0].rot);
    expect(inside).toEqual(preview);
    // The way back faces the seed it was entered from.
    const back = inside.blooms[0];
    expect(back.id).toBe("a");
    const toSeed = Math.atan2(-b.y, -b.x);
    expect(
      Math.abs(Math.atan2(back.y, back.x) - toSeed) % TAU,
    ).toBeLessThanOrEqual(SIXTH / 2 + 1e-9);
  });

  it("keeps every lattice level: a circle's own flower runs level too", () => {
    const f = flowerOf(ids(18), ROOT_ROT);
    for (const b of f.blooms) {
      const r = childRot(b);
      const q = r / SIXTH;
      expect(Math.abs(q - Math.round(q))).toBeLessThan(1e-9);
    }
  });
});

describe("orderKids", () => {
  it("puts the way back first, then the heaviest", () => {
    const w: Record<string, number> = { a: 1, b: 5, c: 3, d: 5 };
    expect(orderKids(["a", "b", "c", "d"], "c", (id) => w[id])).toEqual([
      "c",
      "b",
      "d",
      "a",
    ]);
    expect(orderKids(["a", "b"], null, () => 0)).toEqual(["a", "b"]);
  });
});

describe("the cube's lattice", () => {
  it("joins the fruit of life's 13 centres, every pair once", () => {
    const lines = cubeLines(0);
    expect(lines).toHaveLength(78);
    const pts = new Set(
      lines
        .flatMap(([a, b]) => [a, b])
        .map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`),
    );
    expect(pts.size).toBe(13);
  });

  it("reaches every circle's centre in a bigger flower", () => {
    for (const k of [1, 2, 3, 4]) {
      const lines = latticeLines(k, ROOT_ROT);
      const keys = new Set(
        lines
          .flatMap(([a, b]) => [a, b])
          .map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`),
      );
      for (let m = 0; m <= k; m++)
        for (const p of hexRing(m, ROOT_ROT))
          expect(keys.has(`${p.x.toFixed(3)},${p.y.toFixed(3)}`)).toBe(true);
      const ids = lines.map(([a, b]) =>
        [a, b]
          .map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)
          .sort()
          .join("|"),
      );
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("keeps the lattice inside its rim", () => {
    expect(clipSeg({ x: -2, y: 0 }, { x: 2, y: 0 })).toEqual([
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(clipSeg({ x: -2, y: 2 }, { x: 2, y: 2 })).toBeNull();
    const inside = clipSeg({ x: 0, y: 0 }, { x: 0.5, y: 0 })!;
    expect(inside[1].x).toBeCloseTo(0.5);
    const d = linesPath(cubeLines(0), 0.8);
    for (const n of d.split(/[ML ]/).filter(Boolean).map(Number))
      expect(Math.abs(n)).toBeLessThanOrEqual(1.0001);
  });

  it("draws the flower of life one ring past the circles", () => {
    expect(flowerCentres(1, 0)).toHaveLength(1 + 6 + 12);
  });

  it("draws a vesica as a closed lens", () => {
    const d = vesicaPath({ x: 0, y: 0 }, { x: 1, y: 0 });
    expect(d.startsWith("M")).toBe(true);
    expect(d.match(/A/g)).toHaveLength(2);
    expect(d.endsWith("Z")).toBe(true);
    expect(vesicaPath({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe("");
  });
});

describe("channels", () => {
  const hub = { x: 0, y: 0, r: 0.2 };
  const bloom = { x: 1, y: 0, r: 0.3 };
  const c = channel(hub, bloom, 0.05);

  it("runs two strands rim to rim, one each side", () => {
    // Looking out (+x), screen right is +y: what is sent.
    expect(c.out.y0).toBeCloseTo(0.05);
    expect(c.inn.y0).toBeCloseTo(-0.05);
    for (const s of [c.out, c.inn]) {
      for (const p of [segAt(s, 0), segAt(s, 1)]) {
        const near = Math.min(
          Math.abs(dist(p, hub) - hub.r),
          Math.abs(dist(p, bloom) - bloom.r),
        );
        expect(near).toBeLessThan(1e-9);
      }
    }
  });

  it("sends outward and brings inward", () => {
    expect(segAt(c.out, 0).x).toBeLessThan(segAt(c.out, 1).x);
    expect(segAt(c.inn, 0).x).toBeGreaterThan(segAt(c.inn, 1).x);
    expect(c.mid.x0).toBeCloseTo(0.2);
    expect(c.mid.x1).toBeCloseTo(0.7);
  });
});

describe("names", () => {
  it("keeps short names whole and cuts long ones at a word", () => {
    expect(shortName("Casa Selva", 12)).toBe("Casa Selva");
    expect(shortName("Liminal Village Chaordination", 20)).toBe(
      "Liminal Village…",
    );
    expect(shortName("Supercalifragilistic", 8)).toBe("Superca…");
  });

  it("keeps the number that tells siblings apart", () => {
    expect(shortName("Lunation Cycle 83", 10)).toBe("Lunati… 83");
    expect(shortName("Lunation 83", 8)).toBe("Luna… 83");
    // A short id is never given a second ellipsis.
    expect(shortName("npub13ylzee08…x9q2", 10)).toBe("npub13ylz…");
    expect(shortName("npub13ylzee08…x9q2", 10)).not.toMatch(/……/);
  });

  it("finds siblings that share a name, and their tails", () => {
    const n = new Map([
      ["a", "Oilonics"],
      ["b", "Oilonics"],
      ["c", "Casa Selva"],
    ]);
    expect([...twins(["a", "b", "c"], (id) => n.get(id) ?? id)]).toEqual([
      "a",
      "b",
    ]);
    expect(idTail("-1003864542239")).toBe("#2239");
  });

  it("finds the ties between siblings, each pair once", () => {
    const p = new Map([
      ["a", ["b", "x"]],
      ["b", ["a", "c"]],
      ["c", []],
    ]);
    expect(ties(["a", "b", "c"], (id) => p.get(id))).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
  });
});

describe("fitLabel", () => {
  it("wraps whole words, or says a word is too wide", () => {
    expect(wrapWords("Liminal Village Chaordination", 7.5, mono)).toEqual([
      "Liminal",
      "Village",
      "Chaordination",
    ]);
    expect(wrapWords("Chaordination", 4, mono)).toBeNull();
    expect(wrapWords("Chaordination", 4, mono, "chars")!.join("")).toBe(
      "Chaordination",
    );
  });

  it("sets a short name at the largest size that fits", () => {
    const f = fitLabel(
      "Casa Selva",
      { w: 200, h: 40 },
      {
        max: 16,
        min: 9,
        measure: mono,
      },
    )!;
    expect(f.px).toBe(16);
    expect(f.lines).toEqual(["Casa Selva"]);
    expect(f.cut).toBe(false);
  });

  it("shrinks and wraps before it cuts", () => {
    const f = fitLabel(
      "Liminal Village Chaordination",
      { w: 80, h: 30 },
      { max: 16, min: 9, measure: mono },
    )!;
    expect(f.cut).toBe(false);
    expect(f.lines.join(" ")).toBe("Liminal Village Chaordination");
    expect(f.lines.length).toBeLessThanOrEqual(2);
    for (const l of f.lines) expect(mono(l) * f.px).toBeLessThanOrEqual(80);
    expect(f.lines.length * f.px * 1.15).toBeLessThanOrEqual(30);
  });

  it("keeps a short name on one line when that costs little size", () => {
    const f = fitLabel(
      "Lunation 83",
      { w: 90, h: 40 },
      { max: 16, min: 9, measure: mono },
    )!;
    expect(f.lines).toEqual(["Lunation 83"]);
    // …but wraps when one line would be much smaller.
    const g = fitLabel(
      "Liminal Village Chaordination",
      { w: 90, h: 40 },
      { max: 16, min: 9, measure: mono },
    )!;
    expect(g.lines.length).toBe(2);
  });

  it("can keep a tail line under a cut name", () => {
    const f = fitLabel(
      "Full Moon Celebration",
      { w: 44, h: 30 },
      { max: 12, min: 9, measure: mono, tail: "#5dpu" },
    )!;
    expect(f.lines[f.lines.length - 1]).toBe("#5dpu");
    expect(f.lines.length).toBe(2);
    expect(f.lines[0].startsWith("Full")).toBe(true);
    // A twin whose name wraps still finds a size with its tail under it.
    const g = fitLabel(
      "Lunation 85",
      { w: 44, h: 32 },
      { max: 12, min: 9, lines: 3, measure: mono, tail: "#1455" },
    )!;
    expect(g.lines[g.lines.length - 1]).toBe("#1455");
    expect(g.lines.length * g.px * 1.15).toBeLessThanOrEqual(32);
  });

  it("breaks a long word with a hyphen before it cuts the name", () => {
    const f = fitLabel(
      "Utopolis",
      { w: 30, h: 30 },
      { max: 12, min: 9, measure: mono },
    )!;
    expect(f.cut).toBe(false);
    expect(f.lines).toHaveLength(2);
    expect(f.lines[0].endsWith("-")).toBe(true);
    expect(f.lines.join("").replace("-", "")).toBe("Utopolis");
    for (const l of f.lines) expect(mono(l) * f.px).toBeLessThanOrEqual(30);
    expect(wrapWords("Belgrade Utopolis", 30 / 9, mono, "hyphen")).toEqual([
      "Belg-",
      "rade",
      "Utop-",
      "olis",
    ]);
    expect(wrapWords("-1004332702038", 4, mono, "hyphen")).toBeNull();
    // Never a three-letter stub on the next line: the break moves inward.
    expect(wrapWords("Celebration", 5, mono, "hyphen")).toEqual([
      "Celebr-",
      "ation",
    ]);
  });

  it("sets a whole word smaller before it breaks it with a hyphen", () => {
    // "ReFactory" (9 chars) does not fit 40px at 9px but does at 7.5px.
    const f = fitLabel(
      "ReFactory",
      { w: 40, h: 30 },
      { max: 12, min: 9, wordMin: 7.5, measure: mono },
    )!;
    expect(f.lines).toEqual(["ReFactory"]);
    expect(f.px).toBeLessThan(9);
    expect(f.px).toBeGreaterThanOrEqual(7.5);
    // Without the lower floor it is hyphenated, as before.
    const g = fitLabel(
      "ReFactory",
      { w: 40, h: 30 },
      { max: 12, min: 9, measure: mono },
    )!;
    expect(g.lines[0].endsWith("-")).toBe(true);
  });

  it("cuts only at the smallest size, keeping the number", () => {
    const f = fitLabel(
      "Lunation Cycle Eighty 83",
      { w: 40, h: 12 },
      { max: 14, min: 9, measure: mono },
    )!;
    expect(f.cut).toBe(true);
    expect(f.px).toBe(9);
    expect(f.lines).toHaveLength(1);
    expect(f.lines[0].endsWith(" 83")).toBe(true);
    expect(mono(f.lines[0]) * 9).toBeLessThanOrEqual(40);
  });

  it("gives up rather than squeeze below a stub", () => {
    expect(
      fitLabel(
        "Casa Selva",
        { w: 10, h: 30 },
        { max: 12, min: 9, measure: mono },
      ),
    ).toBeNull();
    expect(
      fitLabel("Casa", { w: 100, h: 5 }, { max: 12, min: 9, measure: mono }),
    ).toBeNull();
  });
});

describe("placeCard", () => {
  const stage = { w: 800, h: 600 };
  const hub = { x0: 350, y0: 250, x1: 450, y1: 350 };

  it("opens away from the seed, over neither it nor the target", () => {
    const target = { x0: 500, y0: 260, x1: 560, y1: 320 };
    const p = placeCard({ w: 200, h: 120 }, target, [hub], stage, {
      x: 1,
      y: 0,
    });
    const card = { x0: p.x, y0: p.y, x1: p.x + 200, y1: p.y + 120 };
    const clear = (a: typeof card, b: typeof card) =>
      a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;
    expect(clear(card, hub)).toBe(true);
    expect(clear(card, target)).toBe(true);
    expect(p.x).toBeGreaterThan(560);
  });

  it("stays inside the stage at an edge", () => {
    const target = { x0: 740, y0: 10, x1: 790, y1: 60 };
    const p = placeCard({ w: 200, h: 120 }, target, [hub], stage, {
      x: 1,
      y: -1,
    });
    expect(p.x).toBeGreaterThanOrEqual(8);
    expect(p.x + 200).toBeLessThanOrEqual(792);
    expect(p.y).toBeGreaterThanOrEqual(8);
    expect(p.y + 120).toBeLessThanOrEqual(592);
  });

  it("keeps off a neighbouring circle when another side is clear", () => {
    const target = { x0: 500, y0: 250, x1: 560, y1: 310 };
    // Right of the target is free, but a neighbour sits there.
    const right = { x0: 572, y0: 220, x1: 700, y1: 340 };
    const p = placeCard(
      { w: 120, h: 80 },
      target,
      [hub],
      stage,
      { x: 1, y: 0 },
      12,
      8,
      [right],
    );
    const r = { x0: p.x, y0: p.y, x1: p.x + 120, y1: p.y + 80 };
    const hits = (a: typeof r, b: typeof r) =>
      a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    expect(hits(r, right)).toBe(false);
    expect(hits(r, target)).toBe(false);
    expect(hits(r, hub)).toBe(false);
  });
});

describe("childrenOf", () => {
  it("is the partners plus the container, sorted, without itself", () => {
    expect(childrenOf("b", ["d", "b", "c"], "a")).toEqual(["a", "c", "d"]);
    expect(childrenOf("b", undefined, null)).toEqual([]);
    expect(childrenOf("b", ["a"], "a")).toEqual(["a"]);
  });

  it("caps what a frame draws, never the way back", () => {
    const many = Array.from({ length: 200 }, (_, i) => `p${i}`);
    const kids = childrenOf("x", many, "zz");
    expect(kids).toHaveLength(MAX_CHILDREN);
    expect(kids).toContain("zz");
  });
});

describe("streams", () => {
  const configs = new Map<string, Record<string, LensDirections>>([
    ["home", { p1: { inbound: ["quests"], outbound: ["events"] } }],
    ["p2", { home: { inbound: [], outbound: ["library", "quests"] } }],
  ]);

  it("folds both sides' records from the frame's side", () => {
    expect(streamOf("home", "p1", configs)).toEqual({
      partner: "p1",
      inbound: ["quests"],
      outbound: ["events"],
    });
    expect(streamOf("home", "p2", configs).inbound).toEqual([
      "library",
      "quests",
    ]);
  });

  it("ranks what reaches the frame first", () => {
    const r = reaching("home", ["p3", "p1", "p2"], configs);
    expect(r.map((s) => s.partner)).toEqual(["p2", "p1", "p3"]);
    expect(lensesReaching(r)).toEqual([
      { lens: "quests", from: ["p2", "p1"] },
      { lens: "library", from: ["p2"] },
    ]);
  });
});

describe("camera", () => {
  it("runs from one framing to the other", () => {
    const a = { x: 0, y: 0, r: 1 };
    const b = { x: 0.5, y: -0.2, r: 0.1 };
    expect(lerpCam(a, b, 0)).toEqual(a);
    const end = lerpCam(a, b, 1);
    expect(end.x).toBeCloseTo(0.5);
    expect(end.r).toBeCloseTo(0.1);
    expect(lerpCam(a, b, 0.5).r).toBeCloseTo(Math.sqrt(0.1));
  });

  it("eases from rest to rest", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
  });

  it("nests a slot inside a slot", () => {
    expect(nest({ x: 0.5, y: 0, r: 0.2 }, { x: 0, y: -1, r: 0.5 })).toEqual({
      x: 0.5,
      y: -0.2,
      r: 0.1,
    });
  });
});

describe("taps", () => {
  it("travels on one tap, opens on two quick ones", () => {
    expect(tapMeaning(null, "a", 0).act).toBe("travel");
    expect(tapMeaning({ id: "a", at: 0 }, "a", 200)).toEqual({
      act: "open",
      id: "a",
    });
    expect(tapMeaning({ id: "a", at: 0 }, "b", 200).act).toBe("travel");
    expect(tapMeaning({ id: "a", at: 0 }, "a", DOUBLE_MS + 1).act).toBe(
      "travel",
    );
  });

  it("opens the circle being flown into, wherever the second tap lands", () => {
    expect(tapMeaning({ id: "a", at: 0 }, null, 300, "a")).toEqual({
      act: "open",
      id: "a",
    });
    expect(tapMeaning({ id: "a", at: 0 }, "z", 300, "a").id).toBe("a");
  });
});

describe("wheelGate", () => {
  const start: WheelState = { acc: 0, last: -1e9, lock: false };

  it("fires once a push builds up, outward or inward", () => {
    let s = start;
    let fired: string | null = null;
    for (let i = 0; i < 5; i++) {
      const r = wheelGate(s, 40, i * 16);
      s = r.state;
      fired = fired ?? r.fire;
    }
    expect(fired).toBe("out");
    expect(wheelGate(start, -200, 0).fire).toBe("in");
  });

  it("lets one inertial swipe travel one level only", () => {
    let s = start;
    let fires = 0;
    for (let i = 0; i < 90; i++) {
      const r = wheelGate(s, 60 * Math.exp(-i / 30), i * 16);
      s = r.state;
      if (r.fire) fires += 1;
    }
    expect(fires).toBe(1);
    expect(wheelGate(s, 200, 90 * 16 + 400).fire).toBe("out");
  });
});

describe("the trail", () => {
  it("goes deeper, or back to a frame already on the trail", () => {
    const t = [
      { id: "a", rot: 0 },
      { id: "b", rot: SIXTH },
    ];
    expect(travel(t, "c", Math.PI)).toEqual([...t, { id: "c", rot: Math.PI }]);
    expect(travel(t, "a", 1)).toEqual([{ id: "a", rot: 0 }]);
  });

  it("reads a stored trail, old or new", () => {
    expect(parseTrail(["a", "b"])).toEqual([
      { id: "a", rot: ROOT_ROT },
      { id: "b", rot: ROOT_ROT },
    ]);
    expect(parseTrail([{ id: "a", rot: SIXTH }])[0].rot).toBeCloseTo(SIXTH);
    expect(parseTrail("x")).toEqual([]);
    expect(parseTrail([{ nope: 1 }])).toEqual([]);
  });
});

describe("top-level marks", () => {
  // Every corner of a box (centre cx, cy; half-sizes hw, hh) inside the
  // unit circle.
  const inside = (cx: number, cy: number, hw: number, hh: number) =>
    [
      [cx - hw, cy - hh],
      [cx + hw, cy - hh],
      [cx - hw, cy + hh],
      [cx + hw, cy + hh],
    ].every(([x, y]) => Math.hypot(x, y) <= 1);

  it("keeps the mark and the name inside the circle, one above the other", () => {
    expect(inside(0, -MARK_RISE, MARK, MARK)).toBe(true);
    expect(inside(0, MARK_DROP, MARK_BOX_W / 2, MARK_BOX_H / 2)).toBe(true);
    // The mark ends above where the name's box begins.
    expect(-MARK_RISE + MARK).toBeLessThanOrEqual(MARK_DROP - MARK_BOX_H / 2);
  });
});

describe("markPlace", () => {
  it("names a circle under its mark only when there is room", () => {
    expect(markPlace(MARK_NAME_MIN)).toEqual({
      half: MARK,
      rise: MARK_RISE,
      named: true,
    });
    const alone = markPlace(MARK_NAME_MIN - 1);
    expect(alone.named).toBe(false);
    expect(alone.rise).toBe(0);
    // Worn alone, the mark is larger and still inside the circle.
    expect(alone.half).toBeGreaterThan(MARK);
    expect(Math.hypot(MARK_ALONE, MARK_ALONE)).toBeLessThanOrEqual(1);
  });
});
