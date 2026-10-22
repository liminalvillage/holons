// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { sameId } from "./ids";

describe("sameId", () => {
  it("matches identical ids and across number/string", () => {
    expect(sameId(7, 7)).toBe(true);
    expect(sameId("7", "7")).toBe(true);
    expect(sameId(7, "7")).toBe(true);
    expect(sameId("7", 7)).toBe(true);
  });

  it("rejects different ids and any null/undefined side", () => {
    expect(sameId(7, 8)).toBe(false);
    expect(sameId("alice", "bob")).toBe(false);
    expect(sameId(null, 7)).toBe(false);
    expect(sameId(7, undefined)).toBe(false);
    expect(sameId(null, null)).toBe(false);
  });
});
