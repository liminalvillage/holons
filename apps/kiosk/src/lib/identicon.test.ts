// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { IDENTICON_SIZE, identiconCells } from "./identicon";

const n = IDENTICON_SIZE;

describe("identiconCells", () => {
  it("is deterministic for an id and stays inside the grid", () => {
    const a = identiconCells("-1003864542239");
    expect(a).toEqual(identiconCells("-1003864542239"));
    for (const [c, r] of a) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(n);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(n);
    }
  });

  it("is mirrored left–right", () => {
    for (const id of [
      "-1003864542239",
      "holon_fig33pftaepw96i4",
      "235114395",
    ]) {
      const lit = new Set(identiconCells(id).map(([c, r]) => `${c},${r}`));
      for (const key of lit) {
        const [c, r] = key.split(",").map(Number);
        expect(lit.has(`${n - 1 - c},${r}`)).toBe(true);
      }
    }
  });

  it("is never blank or solid", () => {
    // Sweep many seeds: the readability floor and ceiling must hold for all.
    for (let i = 0; i < 2000; i++) {
      const cells = identiconCells(`seed-${i}`);
      expect(cells.length).toBeGreaterThanOrEqual(5);
      expect(cells.length).toBeLessThan(n * n);
    }
  });

  it("tells near-identical ids apart", () => {
    // Hubs whose names share an initial — and ids one digit apart.
    const seen = new Set<string>();
    for (const id of [
      "-1003864542239",
      "-1003864542238",
      "-1004318065568",
      "holon_fig33pftaepw96i4",
      "holon_ccdhuztubkrs5thm",
      "235114395",
    ])
      seen.add(JSON.stringify(identiconCells(id)));
    expect(seen.size).toBe(6);
  });

  it("marks an empty seed too", () => {
    expect(identiconCells("").length).toBeGreaterThanOrEqual(5);
  });
});
