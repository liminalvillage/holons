// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  C,
  R_OUTER_MAX,
  RATIO,
  Z,
  Z_MIN,
  Z_MAX,
  depth,
  dragDt,
  flowContext,
  instantAt,
  layoutFlow,
  levelOf,
  levelWeights,
  periodOf,
  placeOn,
  radialPlan,
  ringAt,
  ringRadius,
  ringsAt,
  type FlowCamera,
} from "./flowgeom";
import type { CalendarEvent } from "./data";
import { DAY_MS } from "./yearscale";

const T0 = new Date(2026, 10, 2, 12, 0).getTime(); // 2 Nov 2026, noon local
const ctx = flowContext(T0);

const ev = (
  id: string,
  date: Date,
  extra: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  id,
  title: id,
  date,
  days: 1,
  multiDay: false,
  allDay: false,
  people: [],
  appreciation: 0,
  ...extra,
});

describe("levels", () => {
  it("weights sum to one and plateau at each anchor; depth counts the keyframes", () => {
    for (let z = Z_MIN; z <= Z_MAX; z += 0.05) {
      const w = levelWeights(z);
      expect(w.year + w.lunation + w.phase + w.day).toBeCloseTo(1, 9);
    }
    expect(levelWeights(Z.YEAR).year).toBe(1);
    expect(levelWeights(Z.LUN).lunation).toBe(1);
    expect(levelWeights(Z.PHASE).phase).toBe(1);
    expect(levelWeights(Z.DAY).day).toBe(1);
    expect(depth(Z.YEAR)).toBe(0);
    expect(depth(Z.LUN)).toBe(1);
    expect(depth(Z.PHASE)).toBe(2);
    expect(depth(Z.DAY)).toBe(3);
    expect(levelOf(Z.LUN - 0.1)).toBe("lunation");
  });
});

describe("radialPlan", () => {
  it("fits the fullest outward stack inside the drawing on every box", () => {
    for (const S of [0.8, 1, 1.3, 1.6, 2.2, 3]) {
      const { rO, maxStack } = radialPlan(S);
      expect(rO).toBeGreaterThanOrEqual(300);
      expect(rO).toBeLessThanOrEqual(R_OUTER_MAX);
      expect(maxStack).toBeGreaterThanOrEqual(1);
      expect(maxStack).toBeLessThanOrEqual(5);
      const reach = rO + (13 + 6 + 11 + (maxStack - 1) * 13) * S;
      expect(reach).toBeLessThanOrEqual(500 - 6 * S + 1e-9);
    }
    expect(radialPlan(1).maxStack).toBe(5);
  });
});

describe("rings", () => {
  it("nest self-similarly: the inner ring is the outer one scaled by the ratio", () => {
    for (let d = 0; d <= 3; d += 0.25) {
      for (let level = 0; level < 4; level++) {
        expect(ringRadius(level, d)).toBeCloseTo(
          ringRadius(level + 1, d) * RATIO,
          9,
        );
      }
    }
    expect(ringRadius(1, 1)).toBeCloseTo(R_OUTER_MAX, 9);
    expect(ringRadius(2, 1)).toBeCloseTo(R_OUTER_MAX / RATIO, 9);
  });

  it("grow continuously with the zoom", () => {
    const dz = 0.002;
    for (let z = Z_MIN; z < Z_MAX; z += 0.01) {
      for (let level = 0; level < 4; level++) {
        const a = ringRadius(level, depth(z));
        const b = ringRadius(level, depth(z + dz));
        expect(Math.abs(a - b)).toBeLessThan(2000 * dz);
      }
    }
  });

  it("show the outer and inner ring at every keyframe, and the moon's new moon at twelve", () => {
    expect(
      ringsAt(0)
        .slice(0, 2)
        .map((r) => r.level),
    ).toEqual([0, 1]);
    expect(ringsAt(1).map((r) => r.level)).toContain(1);
    expect(ringsAt(1).map((r) => r.level)).toContain(2);
    const cam = { z: Z.LUN, t0: T0 };
    const newMoon = placeOn(1, ctx.focus.from, cam, ctx);
    expect(newMoon.x).toBeCloseTo(C, 6);
    expect(newMoon.y).toBeCloseTo(C - R_OUTER_MAX, 6);
  });
});

describe("periods", () => {
  it("nest: each level's period contains the focus and lies within the one above", () => {
    for (let level = 0; level < 4; level++) {
      const p = periodOf(level, T0, ctx);
      expect(p.from).toBeLessThanOrEqual(T0);
      expect(p.to).toBeGreaterThan(T0);
      if (level > 0) {
        const outer = periodOf(level - 1, T0, ctx);
        expect(p.from).toBeGreaterThanOrEqual(outer.from - 1);
        expect(p.to).toBeLessThanOrEqual(outer.to + 1);
      }
    }
    expect(periodOf(1, T0, ctx).from).toBe(ctx.focus.from);
    expect(periodOf(3, T0, ctx).to - periodOf(3, T0, ctx).from).toBe(DAY_MS);
  });
});

describe("ringAt / instantAt", () => {
  it("inverts placeOn on every visible ring, and is null between rings", () => {
    for (const z of [Z.YEAR, Z.YEAR - 0.8, Z.LUN, Z.LUN - 1, Z.PHASE, Z.DAY]) {
      const cam: FlowCamera = { z, t0: T0 };
      for (const { level } of ringsAt(depth(z))) {
        const p = periodOf(level, T0, ctx);
        for (const f of [0.05, 0.3, 0.62, 0.9]) {
          const t = p.from + f * (p.to - p.from);
          const at = placeOn(level, t, cam, ctx);
          const hit = ringAt(at.x, at.y, cam, ctx);
          expect(hit?.level, `z=${z} level=${level}`).toBe(level);
          expect(Math.abs(hit!.t - t)).toBeLessThan((p.to - p.from) * 1e-6);
        }
      }
      expect(instantAt(C, C, cam, ctx)).toBeNull();
    }
  });
});

describe("dragDt", () => {
  it("turns the ring under the finger: a full lap is the period", () => {
    const cam = { z: Z.LUN, t0: T0 };
    const p = periodOf(1, T0, ctx);
    const a = placeOn(1, p.from + 0.1 * (p.to - p.from), cam, ctx);
    const b = placeOn(1, p.from + 0.35 * (p.to - p.from), cam, ctx);
    const dt = dragDt({ x: a.x, y: a.y }, { x: b.x, y: b.y }, cam, ctx);
    expect(dt / (p.to - p.from)).toBeCloseTo(0.25, 6);
  });
});

describe("layoutFlow", () => {
  const events = [
    ev("a", new Date(2026, 10, 2, 9, 0), {
      end: new Date(2026, 10, 2, 10, 30),
    }),
    ev("b", new Date(2026, 10, 2, 9, 30)),
    ev("c", new Date(2026, 10, 2), { allDay: true }),
    ev("d", new Date(2026, 10, 20, 18, 0)),
    ev("e", new Date(2026, 9, 1, 18, 0)),
    ev("s", new Date(2026, 10, 1), {
      allDay: true,
      multiDay: true,
      days: 4,
      end: new Date(2026, 10, 4),
    }),
  ];
  // A crowded day too: nine cards on 5 Nov, and a cluster at 17:00.
  for (let i = 0; i < 9; i++)
    events.push(ev(`n${i}`, new Date(2026, 10, 5, 8 + i, 0)));
  for (let i = 0; i < 4; i++)
    events.push(
      ev(`x${i}`, new Date(2026, 10, 2, 17, 0), {
        end: new Date(2026, 10, 2, 18, 0),
      }),
    );
  // A followed calendar's series: one id, several occurrences — and a twin
  // of one of them at the very same moment.
  for (let i = 0; i < 3; i++)
    events.push(
      ev("ext:series", new Date(2026, 10, 2 + i, 10, 30), {
        external: { calendarName: "x", url: "" },
      }),
    );
  events.push(ev("twin", new Date(2026, 10, 2, 10, 30)));
  const now = new Date(T0);
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  it("puts each ring's cards on it: the year's, the moon's, the quadrant's, the day's", () => {
    const year = layoutFlow({
      events,
      now,
      cam: { z: Z.YEAR, t0: T0 },
      ctx,
      weekdays,
    });
    const yr = year.rings.find((r) => r.level === 0)!;
    const mr = year.rings.find((r) => r.level === 1)!;
    const ids = (r: typeof yr) =>
      [...new Set(r.cards.map((c) => c.ev.id))].sort();
    expect(ids(yr)).toContain("a");
    expect(ids(yr)).toContain("e");
    expect(yr.spans).toHaveLength(1);
    expect(yr.sectors.length).toBeGreaterThanOrEqual(12);
    // The inner moon ring (10 Oct – 9 Nov) holds a, b, c and the crowded day — as chips or marks.
    expect(mr.cards.length + mr.marks.length).toBeGreaterThan(0);
    expect(mr.r).toBeCloseTo(year.rO / RATIO, 6);

    const day = layoutFlow({
      events,
      now,
      cam: { z: Z.DAY, t0: T0 },
      ctx,
      weekdays,
    });
    const dr = day.rings.find((r) => r.level === 3)!;
    expect(ids(dr)).toEqual([
      "a",
      "b",
      "c",
      "ext:series",
      "twin",
      "x0",
      "x1",
      "x2",
      "x3",
    ]);
    expect(dr.ticks).toHaveLength(24);
    expect(dr.now).not.toBeNull();
    // The 17:00 cluster packs into columns away from the band.
    const cols = dr.cards
      .filter((c) => c.ev.id.startsWith("x"))
      .map((c) => c.col);
    expect(new Set(cols).size).toBe(4);
    // The clock's cards sit inside its face.
    expect(dr.rOut).toBeGreaterThan(dr.r + dr.half);

    const phase = layoutFlow({
      events,
      now,
      cam: { z: Z.PHASE, t0: T0 },
      ctx,
      weekdays,
    });
    const pr = phase.rings.find((r) => r.level === 2)!;
    expect(pr.sectors.some((s) => s.label?.startsWith("Mon"))).toBe(true);
    expect(phase.readout.lunation.index).toBe(ctx.focus.index);
  });

  it("draws the nest at every depth between the keyframes", () => {
    for (let z = Z_MIN; z <= Z_MAX; z += 0.05) {
      const s = layoutFlow({
        events,
        now,
        cam: { z, t0: T0 },
        ctx,
        weekdays,
        unitsPerPx: 2.2,
      });
      expect(s.rings.length, `z=${z.toFixed(2)}`).toBeGreaterThanOrEqual(1);
      // Some ring is well on screen at every depth (a leaving one may be faint).
      expect(
        Math.max(...s.rings.map((r) => r.opacity)),
        `z=${z.toFixed(2)}`,
      ).toBeGreaterThan(0.6);
    }
  });

  it("lets nothing overlap at any keyframe, on any box", () => {
    for (const S of [1, 1.3, 2.2]) {
      for (const z of [Z.YEAR, Z.LUN, Z.PHASE, Z.DAY]) {
        const s = layoutFlow({
          events,
          now,
          cam: { z, t0: T0 },
          ctx,
          weekdays,
          unitsPerPx: S,
        });
        const edge = 6 * S;
        // Rings keep clear of each other and of the drawing's edge.
        expect(s.rings[0].rOut, `S=${S} z=${z}`).toBeLessThanOrEqual(
          500 - edge + 1e-6,
        );
        for (let i = 0; i + 1 < s.rings.length; i++) {
          const outer = s.rings[i];
          const inner = s.rings[i + 1];
          expect(
            inner.rOut,
            `S=${S} z=${z} ${inner.name} into ${outer.name}`,
          ).toBeLessThanOrEqual(outer.rIn - edge + 1e-6);
        }
        for (const r of s.rings) {
          // A day's chips are one straight spoke: the same angle, one step
          // apart along the radius, outward from the band.
          const byF = new Map<number, typeof r.cards>();
          for (const c of r.cards)
            (byF.get(c.f) ?? byF.set(c.f, []).get(c.f)!).push(c);
          for (const spoke of byF.values()) {
            const radii = spoke
              .map((c) => Math.hypot(c.x - C, c.y - C))
              .sort((a, b) => a - b);
            expect(radii[0]).toBeGreaterThan(r.r + r.half);
            for (let i = 0; i + 1 < radii.length; i++)
              expect(radii[i + 1] - radii[i]).toBeCloseTo(13 * S, 6);
          }
          for (const c of r.cards) {
            expect(c.opacity).toBeGreaterThanOrEqual(0);
            expect(c.opacity).toBeLessThanOrEqual(1);
          }
        }
        // The outer ring is fully on and functional: every card of its period drawn or marked.
        const outer = s.rings.find((r) => r.focus >= 0.999)!;
        expect(outer.opacity).toBeCloseTo(1, 6);
        expect(outer.cards.length + outer.marks.length).toBeGreaterThan(0);
      }
    }
  });
});
