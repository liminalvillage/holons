// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";

// A localStorage for the spec: config reads the global, so give it one
// before the modules under test load.
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

const { resolveHolonId, resolveStarredHolon } = await import("./config");
const { dropStar, starredHolon, toggleStar } = await import("./star");

describe("the star", () => {
  beforeEach(() => {
    mem.clear();
    starredHolon.set(null);
  });

  it("is what a bare visit opens", () => {
    expect(resolveHolonId()).toBeNull();
    expect(toggleStar("-100111")).toBe(true);
    expect(get(starredHolon)).toBe("-100111");
    expect(resolveHolonId()).toBe("-100111");
  });

  it("comes off on a second tap", () => {
    toggleStar("-100111");
    expect(toggleStar("-100111")).toBe(false);
    expect(get(starredHolon)).toBeNull();
    expect(resolveHolonId()).toBeNull();
  });

  it("is one per device: starring another holon moves it", () => {
    toggleStar("-100111");
    expect(toggleStar("-100222")).toBe(true);
    expect(resolveStarredHolon()).toBe("-100222");
  });

  it("drops only with its own holon", () => {
    toggleStar("-100111");
    dropStar("-100222");
    expect(get(starredHolon)).toBe("-100111");
    dropStar("-100111");
    expect(resolveStarredHolon()).toBeNull();
  });
});
