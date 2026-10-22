// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { membersForSync, mirrorAllocation } from "./allocationMirror";

const scored = [
  { userId: "a", percentage: 60 },
  { userId: "b", percentage: 40 },
];

describe("membersForSync", () => {
  it("sends the scored shares under the equation", () => {
    expect(
      membersForSync({ interiorMode: "equation" }, scored, { z: 100 }),
    ).toEqual(scored);
    expect(membersForSync({}, scored)).toEqual(scored);
  });

  it("sends the custom shares under a custom split", () => {
    expect(
      membersForSync({ interiorMode: "custom" }, scored, { b: 30, z: 70 }),
    ).toEqual([
      { userId: "b", percentage: 30 },
      { userId: "z", percentage: 70 },
    ]);
  });

  it("falls back to the scored shares when the custom split is empty", () => {
    expect(membersForSync({ interiorMode: "custom" }, scored, {})).toEqual(
      scored,
    );
  });
});

describe("mirrorAllocation", () => {
  it("writes the split, zones and shares onto the settings document", async () => {
    const docs: Record<string, any> = { h: { id: "h", name: "Grove" } };
    const hs: any = {
      get: async (_h: string, _l: string, id: string) => docs[id] ?? null,
      put: async (_h: string, _l: string, doc: any) => {
        docs[doc.id] = doc;
      },
    };
    await mirrorAllocation(
      hs,
      "h",
      { interiorPercent: 70, steepness: 40, nzones: 2, interiorMode: "custom" },
      [
        { id: "p1", zone: 1 },
        { id: "p2", zone: 0 },
      ],
      { a: 1, b: 1 },
    );
    expect(docs.h.name).toBe("Grove");
    expect(docs.h.allocation).toMatchObject({
      interiorPercent: 70,
      steepness: 40,
      nzones: 2,
      interiorMode: "custom",
      zones: { p1: 1, p2: 0 },
      shares: { a: 1, b: 1 },
    });
  });
});
