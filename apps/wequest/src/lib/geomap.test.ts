// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { distLabel, neighborhood, projectCells } from "./geomap";

const CENTER = "8928308280fffff"; // res-9 cell (San Francisco area)

describe("geomap", () => {
  it("neighborhood returns the centre plus k rings", () => {
    const cells = neighborhood(CENTER, 2);
    expect(cells).toContain(CENTER);
    expect(cells.length).toBe(1 + 6 + 12); // gridDisk k=2
  });

  it("projects every cell inside the viewport, centre near the middle", () => {
    const cells = neighborhood(CENTER, 3);
    const projected = projectCells(CENTER, cells, 358, 330);
    expect(projected).toHaveLength(cells.length);
    for (const p of projected) {
      for (const pair of p.pts.split(" ")) {
        const [x, y] = pair.split(",").map(Number);
        expect(x).toBeGreaterThanOrEqual(-1);
        expect(x).toBeLessThanOrEqual(359);
        expect(y).toBeGreaterThanOrEqual(-1);
        expect(y).toBeLessThanOrEqual(331);
      }
    }
    const centre = projected.find((p) => p.cell === CENTER)!;
    expect(centre.distKm).toBe(0);
    expect(centre.cx).toBeGreaterThan(358 / 4);
    expect(centre.cx).toBeLessThan((358 * 3) / 4);
    expect(centre.cy).toBeGreaterThan(330 / 4);
    expect(centre.cy).toBeLessThan((330 * 3) / 4);
  });

  it("distances grow with the ring and format sensibly", () => {
    const cells = neighborhood(CENTER, 1);
    const projected = projectCells(CENTER, cells, 358, 330);
    const others = projected.filter((p) => p.cell !== CENTER);
    for (const p of others) expect(p.distKm).toBeGreaterThan(0);
    expect(distLabel(0.4)).toBe("400 m");
    expect(distLabel(1.23)).toBe("1.2 km");
  });
});
