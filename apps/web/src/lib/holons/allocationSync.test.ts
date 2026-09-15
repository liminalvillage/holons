// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from "vitest";
import { membersForSync, syncAllocation } from "./allocationSync";

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

describe("syncAllocation", () => {
  it("pushes the resolved roster to the contract and mirrors mode and shares", async () => {
    const syncAll = vi.fn(async (_address: string, _params: any) => ({
      hash: "0xabc",
    }));
    const put = vi.fn(async (_holon: string, _lens: string, _data: any) => {});
    const holosphere = { get: async () => ({ id: "h1", name: "Casa" }), put };

    await syncAllocation({
      manager: { syncAll } as any,
      holosphere: holosphere as any,
      holonId: "h1",
      bundleAddress: "0x0000000000000000000000000000000000000001",
      draft: {
        interiorPercent: 60,
        steepness: 50,
        nzones: 3,
        interiorMode: "custom",
      },
      members: scored,
      partners: [
        { id: "p1", zone: 2 },
        { id: "p2", zone: 0 },
      ],
      shares: { a: 10, c: 90 },
    });

    const sent = syncAll.mock.calls[0][1];
    expect(sent.interiorMembers).toEqual([
      { userId: "a", percentage: 10 },
      { userId: "c", percentage: 90 },
    ]);
    expect(sent.exteriorMembers).toEqual([{ userId: "p1", zone: 2 }]);

    const doc = put.mock.calls[0][2];
    expect(doc.name).toBe("Casa");
    expect(doc.allocation.interiorMode).toBe("custom");
    expect(doc.allocation.shares).toEqual({ a: 10, c: 90 });
    expect(doc.allocation.zones).toEqual({ p1: 2, p2: 0 });
  });
});
