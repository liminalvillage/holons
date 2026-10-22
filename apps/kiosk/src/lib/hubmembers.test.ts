// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it as spec } from "vitest";
import { parseDismissed } from "./hubmembers";

describe("dismissed join requests", () => {
  spec("parse keeps only hub|pubkey marks", () => {
    expect(parseDismissed(null).size).toBe(0);
    expect(parseDismissed("{")).toEqual(new Set());
    expect([
      ...parseDismissed(JSON.stringify(["holon_a|abc", 42, "nomark", "h|k"])),
    ]).toEqual(["holon_a|abc", "h|k"]);
  });
});
