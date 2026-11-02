// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { get } from "svelte/store";
import { createFlowZoom, dive, wheelDz } from "./flowzoom";
import {
  Z,
  Z_MIN,
  Z_MAX,
  dragDt,
  flowContext,
  instantAt,
  placeOn,
} from "./flowgeom";
import { DAY_MS } from "./yearscale";

const T0 = new Date(2026, 10, 2, 12, 0).getTime();
const ctx = flowContext(T0);
const inv = (x: number, y: number, cam: { z: number; t0: number }) =>
  instantAt(x, y, cam, ctx);
const bounds = { zMin: Z_MIN, zMax: Z_MAX };

describe("dive", () => {
  it("zooming in on a ring makes the instant there the focus", () => {
    const cam = { z: Z.YEAR, t0: T0 };
    const t = new Date(2026, 2, 15, 12).getTime();
    const p = placeOn(0, t, cam, ctx);
    const next = dive(cam, -0.2, { x: p.x, y: p.y }, bounds, inv);
    expect(Math.abs(next.t0 - t)).toBeLessThan(DAY_MS);
    expect(next.z).toBeCloseTo(Z.YEAR - 0.2, 9);
  });

  it("zooming out, or in on empty space, keeps the focus", () => {
    const cam = { z: Z.LUN, t0: T0 };
    expect(dive(cam, 0.3, { x: 500, y: 500 }, bounds, inv).t0).toBe(T0);
    expect(dive(cam, -0.3, { x: 500, y: 500 }, bounds, inv).t0).toBe(T0);
    expect(dive({ z: Z_MAX, t0: T0 }, 1, undefined, bounds, inv)).toEqual({
      z: Z_MAX,
      t0: T0,
    });
  });
});

describe("wheelDz", () => {
  it("is bounded and signed: scrolling down zooms out", () => {
    expect(wheelDz(100, 0)).toBeGreaterThan(0);
    expect(wheelDz(-100, 0)).toBeLessThan(0);
    expect(wheelDz(5000, 0)).toBeLessThanOrEqual(0.32);
    expect(wheelDz(-5000, 0)).toBeGreaterThanOrEqual(-0.32);
    expect(wheelDz(3, 1)).toBeCloseTo(wheelDz(48, 0), 9);
  });
});

describe("dragDt", () => {
  it("turning the day clock a quarter turn clockwise is six hours forward", () => {
    const cam = { z: Z.DAY, t0: T0 };
    const a = placeOn(3, T0, cam, ctx);
    const b = placeOn(3, T0 + 6 * 3600_000, cam, ctx);
    const dt = dragDt({ x: a.x, y: a.y }, { x: b.x, y: b.y }, cam, ctx);
    expect(dt / 3600_000).toBeCloseTo(6, 3);
    expect(
      dragDt({ x: b.x, y: b.y }, { x: a.x, y: a.y }, cam, ctx),
    ).toBeLessThan(0);
  });
});

describe("createFlowZoom", () => {
  function fakeRaf() {
    const queue: Array<(t: number) => void> = [];
    let now = 0;
    return {
      raf: (cb: (t: number) => void) => {
        queue.push(cb);
        return queue.length;
      },
      now: () => now,
      tick(ms = 16) {
        now += ms;
        const cbs = queue.splice(0);
        for (const cb of cbs) cb(now);
      },
      pending: () => queue.length,
    };
  }
  const make = () => {
    const f = fakeRaf();
    const zoom = createFlowZoom({
      initial: { z: Z.YEAR, t0: T0 },
      ...bounds,
      instantAt: inv,
      dragDt: (a, b, cam) => dragDt(a, b, cam, ctx),
      raf: f.raf,
      now: f.now,
    });
    return { zoom, f };
  };

  it("flies to a target, monotone in z, and lands exactly", () => {
    const { zoom, f } = make();
    const target = { z: Z.DAY, t0: T0 + DAY_MS };
    zoom.flyTo(target, 200);
    let last = get(zoom.camera).z;
    for (let i = 0; i < 20; i++) {
      f.tick(16);
      const z = get(zoom.camera).z;
      expect(z).toBeLessThanOrEqual(last + 1e-9);
      last = z;
    }
    expect(get(zoom.camera)).toEqual(target);
    expect(f.pending()).toBe(0);
  });

  it("zooms in bounded steps per frame until the whole request is spent", () => {
    const { zoom, f } = make();
    zoom.zoomBy(-1.0);
    f.tick();
    f.tick();
    expect(Z.YEAR - get(zoom.camera).z).toBeCloseTo(0.25, 6);
    for (let i = 0; i < 10; i++) f.tick();
    expect(get(zoom.camera).z).toBeCloseTo(Z.YEAR - 1, 6);
  });

  it("dives once per burst of notches", () => {
    const { zoom, f } = make();
    const cam = { z: Z.YEAR, t0: T0 };
    const march = new Date(2026, 2, 15, 12).getTime();
    const p = placeOn(0, march, cam, ctx);
    zoom.zoomBy(-0.3, { x: p.x, y: p.y });
    f.tick();
    f.tick();
    const t1 = get(zoom.camera).t0;
    expect(Math.abs(t1 - march)).toBeLessThan(DAY_MS);
    // The next notch of the same burst lands on a different ring point now
    // (the year ring has moved); it must not refocus again.
    zoom.zoomBy(-0.3, { x: 500, y: 500 - 300 });
    f.tick();
    f.tick();
    expect(get(zoom.camera).t0).toBe(t1);
  });

  it("pans the focus and clamps on set", () => {
    const { zoom, f } = make();
    zoom.panBy(DAY_MS);
    f.tick();
    expect(get(zoom.camera).t0).toBe(T0 + DAY_MS);
    zoom.set({ z: 99, t0: T0 });
    f.tick();
    expect(get(zoom.camera).z).toBe(Z_MAX);
  });
});
