// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from "vitest";

vi.mock("./holosphere", () => ({ getHolosphere: vi.fn() }));
vi.mock("./names", () => ({
  resolveNames: vi.fn(),
  isShortName: (name: string, id: string) => !name || name === id.slice(0, 6),
}));

import { nameToKeep } from "./myhubs";

describe("nameToKeep", () => {
  it("prefers what the resolver learned over a stale label", async () => {
    // A federation retinue once docked Casa Selva under a partner's old label.
    const keep = await nameToKeep(
      "-1002964866719",
      "Roberto",
      async () => "Casa Selva",
    );
    expect(keep).toBe("Casa Selva");
  });

  it("keeps the given label while the resolver knows nothing", async () => {
    expect(await nameToKeep("-1002964866719", "Roberto", async () => "")).toBe(
      "Roberto",
    );
    expect(
      await nameToKeep("-1002964866719", "Roberto", async () => "-10029"),
    ).toBe("Roberto");
    expect(
      await nameToKeep("-1002964866719", "Roberto", async () => {
        throw new Error("offline");
      }),
    ).toBe("Roberto");
  });
});
