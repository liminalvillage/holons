// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { ICONS, MOON_ICONS, isIconName } from "./icons";
import { TABS } from "./stores";
import { LAYOUT_SEGMENTS, SORT_SEGMENTS } from "./pills";

// A path either starts with a move-to and only uses path syntax, or the
// browser draws nothing and the icon silently vanishes.
const PATH = /^M[\d.\-\s,MLHVCSQTAZmlhvcsqtaz]+$/;

describe("icon catalog", () => {
  it("every icon is at least one well-formed path inside the 24×24 box", () => {
    for (const [name, def] of Object.entries(ICONS)) {
      expect(def.paths.length, name).toBeGreaterThan(0);
      for (const seg of def.paths) {
        expect(seg.d, name).toMatch(PATH);
        // Path syntax elides the leading zero (".54") and the separator
        // before a negative ("7.54-7.07"), so split on that grammar.
        const nums = seg.d.match(/-?(\d+\.?\d*|\.\d+)/g)!.map(Number);
        for (const n of nums) expect(Math.abs(n), name).toBeLessThanOrEqual(24);
      }
    }
  });

  it("names the eight moon faces in phase order", () => {
    expect(MOON_ICONS).toHaveLength(8);
    for (const m of MOON_ICONS) expect(isIconName(m)).toBe(true);
    // New moon is an outline alone; full moon is fully lit; the waxing
    // faces grow, the waning ones shrink.
    expect(ICONS.moon0.paths.some((p) => p.fill)).toBe(false);
    expect(ICONS.moon4.paths.some((p) => p.fill)).toBe(true);
    expect(ICONS.moon1.paths).toHaveLength(2);
    expect(ICONS.moon7.paths).toHaveLength(2);
  });

  it("covers every tab and every shared pill segment", () => {
    for (const tab of TABS) expect(isIconName(tab.icon), tab.id).toBe(true);
    for (const seg of Object.values(LAYOUT_SEGMENTS))
      expect(isIconName(seg.icon)).toBe(true);
    for (const seg of SORT_SEGMENTS) expect(isIconName(seg.icon)).toBe(true);
  });

  it("rejects names that are not in the catalog", () => {
    expect(isIconName("⚙")).toBe(false);
    expect(isIconName("toString")).toBe(false);
  });
});
