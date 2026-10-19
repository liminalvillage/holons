// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { layoutSankey, type ValueFlowTrack } from "@holons/core/flows";
import { ribbonBandAt, sankeyHit } from "./sankeyHit";

const W = 360;
const H = 400;

/** One source feeding a big bar, a medium one and a sliver. */
const track: ValueFlowTrack = {
  id: "allocation",
  unit: "",
  nodes: [
    { id: "src", label: "Source", depth: 0, value: 100 },
    { id: "big", label: "Big", depth: 1, value: 79.5 },
    { id: "mid", label: "Mid", depth: 1, value: 20 },
    { id: "thin", label: "Thin", depth: 1, value: 0.5 },
  ],
  links: [
    { id: "src>big", source: "src", target: "big", value: 79.5 },
    { id: "src>mid", source: "src", target: "mid", value: 20 },
    { id: "src>thin", source: "src", target: "thin", value: 0.5 },
  ],
  totalIn: 100,
  totalOut: 100,
  balance: null,
};
const layout = layoutSankey(track);
const node = (id: string) => layout.nodes.find((n) => n.id === id)!;
const centre = (id: string) => {
  const n = node(id);
  return { x: (n.x + n.w / 2) * W, y: (n.y + n.h / 2) * H };
};
const hit = (x: number, y: number) => sankeyHit(layout, x, y, { w: W, h: H });
const idOf = (h: ReturnType<typeof hit>) =>
  h == null ? null : h.type === "node" ? h.node.id : h.link.id;

describe("sankeyHit", () => {
  it("takes a tap on a bar for the bar", () => {
    const c = centre("big");
    expect(hit(c.x, c.y)).toMatchObject({ type: "node", node: { id: "big" } });
    const s = centre("src");
    expect(idOf(hit(s.x, s.y))).toBe("src");
  });

  it("gives a sliver a fingertip of room", () => {
    const thin = node("thin");
    expect(thin.h * H).toBeLessThan(4);
    const c = centre("thin");
    expect(idOf(hit(c.x, c.y))).toBe("thin");
    expect(idOf(hit(c.x + 18, c.y + 10))).toBe("thin");
  });

  it("keeps a bar's own ground its own, and gives the gap beside a sliver to the sliver", () => {
    const mid = node("mid");
    const thin = node("thin");
    const x = centre("mid").x;
    const midBottom = (mid.y + mid.h) * H;
    const thinTop = thin.y * H;
    // Inside the bigger bar, though the sliver's grown box reaches here too.
    expect(idOf(hit(x, midBottom - 2))).toBe("mid");
    // In the gap between them only the sliver's box reaches.
    expect(idOf(hit(x, (midBottom + thinTop) / 2))).toBe("thin");
    expect(idOf(hit(x, thinTop - 1))).toBe("thin");
  });

  it("takes a tap between the columns for the ribbon under it, or the nearest in reach", () => {
    const x = W / 2;
    const band = ribbonBandAt(
      layout.links.find((l) => l.id === "src>big")!.path,
      0.5,
    )!;
    expect(idOf(hit(x, ((band.top + band.bottom) / 2) * H))).toBe("src>big");
    const thinBand = ribbonBandAt(
      layout.links.find((l) => l.id === "src>thin")!.path,
      0.5,
    )!;
    expect(idOf(hit(x, thinBand.bottom * H + 12))).toBe("src>thin");
  });

  it("is nothing on bare paper, and nothing without a drawing", () => {
    const thinBand = ribbonBandAt(
      layout.links.find((l) => l.id === "src>thin")!.path,
      0.5,
    )!;
    expect(hit(W / 2, thinBand.bottom * H + 60)).toBeNull();
    expect(sankeyHit(null, 10, 10, { w: W, h: H })).toBeNull();
    expect(sankeyHit(layout, 10, 10, { w: 0, h: H })).toBeNull();
    expect(
      sankeyHit({ nodes: [], links: [], columns: 0, empty: true }, 1, 1, {
        w: W,
        h: H,
      }),
    ).toBeNull();
  });
});

describe("ribbonBandAt", () => {
  it("meets its bars at both ends and is null beside them", () => {
    const l = layout.links.find((x) => x.id === "src>mid")!;
    const src = node("src");
    const mid = node("mid");
    const start = ribbonBandAt(l.path, src.x + src.w)!;
    const end = ribbonBandAt(l.path, mid.x)!;
    expect(end.top).toBeCloseTo(mid.y, 2);
    expect(end.bottom).toBeCloseTo(mid.y + mid.h, 2);
    expect(start.bottom - start.top).toBeGreaterThan(0);
    expect(ribbonBandAt(l.path, 0.001)).toBeNull();
    expect(ribbonBandAt("M0,0", 0.5)).toBeNull();
  });
});
