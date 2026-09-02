// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The lens layer's pure pieces: zoom band alignment with the dashboard map,
// the persisted presence-cache codec (dashboard row format + TTL), the
// presence rule per lens, and the panel's item labelling.

import { describe, it, expect } from "vitest";
import { getResolution, isValidCell } from "h3-js";
import {
  LENSES,
  countsAsPresent,
  edgeFade,
  globalCells,
  isLensId,
  itemLabel,
  lensColor,
  looksLikeRecord,
  parsePresence,
  PRESENCE_TTL_MS,
  resolutionToZoom,
  serializePresence,
  viewportCells,
  zoomToResolution,
} from "./maplens";

describe("lens catalog", () => {
  it("carries the dashboard's 18 lenses with their colours", () => {
    expect(LENSES).toHaveLength(18);
    expect(lensColor("quests")).toBe("#f44336");
    expect(lensColor("canvases")).toBe("#455a64");
  });

  it("isLensId accepts catalog ids and rejects everything else", () => {
    expect(isLensId("library")).toBe(true);
    expect(isLensId("settings")).toBe(false);
    expect(isLensId(null)).toBe(false);
  });
});

describe("zoom ↔ resolution bands (dashboard-aligned)", () => {
  it("maps zooms into the dashboard's resolution bands", () => {
    expect(zoomToResolution(2)).toBe(0);
    expect(zoomToResolution(3.0)).toBe(0); // band edges are inclusive
    expect(zoomToResolution(5)).toBe(2);
    expect(zoomToResolution(13)).toBe(8);
    expect(zoomToResolution(21.9)).toBe(14);
    expect(zoomToResolution(23)).toBe(15);
  });

  it("resolutionToZoom is the band's edge, so a round-trip is stable", () => {
    expect(resolutionToZoom(0)).toBe(3.0);
    expect(resolutionToZoom(9)).toBe(15.5);
    expect(resolutionToZoom(99)).toBe(22.0);
    for (const res of [0, 3, 7, 12]) {
      expect(zoomToResolution(resolutionToZoom(res))).toBe(res);
    }
  });
});

describe("viewport grid", () => {
  it("fills a normal viewport at the asked resolution", () => {
    const cells = viewportCells(
      { west: -10, south: 35, east: 30, north: 60 },
      1,
    );
    expect(cells.length).toBeGreaterThan(5);
    for (const c of cells) {
      expect(isValidCell(c)).toBe(true);
      expect(getResolution(c)).toBe(1);
    }
  });

  it("serves the whole globe when fully zoomed out (the bug: h3 gave nothing)", () => {
    const world = { west: -300, south: -85, east: 300, north: 85 };
    expect(viewportCells(world, 0)).toHaveLength(122);
    expect(viewportCells(world, 1)).toHaveLength(842);
    expect(viewportCells(world, 2)).toHaveLength(5882);
    // finer than the global set is meant for — nothing, never an explosion
    expect(viewportCells(world, 3)).toEqual([]);
    expect(globalCells(0)).toHaveLength(122);
  });

  it("re-wraps unwrapped longitudes and copes with the antimeridian", () => {
    const wrapped = viewportCells(
      { west: -370, south: 35, east: -330, north: 60 },
      1,
    );
    const plain = viewportCells(
      { west: -10, south: 35, east: 30, north: 60 },
      1,
    );
    expect(new Set(wrapped)).toEqual(new Set(plain));
    const crossing = viewportCells(
      { west: 170, south: 20, east: 190, north: 40 },
      2,
    );
    expect(crossing.length).toBeGreaterThan(5);
  });

  it("keeps latitudes off the poles and rejects empty boxes", () => {
    expect(
      viewportCells({ west: -20, south: 60, east: 20, north: 90 }, 1).length,
    ).toBeGreaterThan(0);
    expect(
      viewportCells({ west: 10, south: 0, east: 10, north: 10 }, 1),
    ).toEqual([]);
    expect(
      viewportCells({ west: 0, south: 10, east: 10, north: 0 }, 1),
    ).toEqual([]);
  });

  it("edgeFade is full in the middle, gone at the corners, monotone between", () => {
    expect(edgeFade(0, 0)).toBe(1);
    expect(edgeFade(0.3, 0.3)).toBe(1);
    expect(edgeFade(1, 1)).toBe(0);
    expect(edgeFade(-1, 1)).toBe(0);
    const mid = edgeFade(0.8, 0);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(edgeFade(1, 0)).toBeLessThan(mid);
  });
});

describe("presence cache codec", () => {
  it("round-trips entries through the dashboard's row format", () => {
    const now = 1_000_000;
    const rows = new Map([
      ["8a2a1072b59ffff", { has: true, ts: now }],
      ["852a1073fffffff", { has: false, ts: now - 5 }],
    ]);
    const raw = serializePresence(rows);
    expect(JSON.parse(raw)["8a2a1072b59ffff"]).toEqual([now, 1]);
    expect(parsePresence(raw, now)).toEqual(rows);
  });

  it("drops expired and malformed rows, tolerates corrupt blobs", () => {
    const now = Date.now();
    const raw = JSON.stringify({
      fresh: [now - 1000, 1],
      stale: [now - PRESENCE_TTL_MS - 1, 1],
      junk: "nope",
      noTs: [null, 1],
    });
    const parsed = parsePresence(raw, now);
    expect([...parsed.keys()]).toEqual(["fresh"]);
    expect(parsePresence("{not json", now).size).toBe(0);
    expect(parsePresence(null, now).size).toBe(0);
  });
});

describe("countsAsPresent", () => {
  it("counts any live item, but never nulls or tombstones", () => {
    expect(countsAsPresent("library", { id: "x" })).toBe(true);
    expect(countsAsPresent("library", null)).toBe(false);
    expect(countsAsPresent("library", { id: "x", _deleted: true })).toBe(false);
  });

  it("quests must also still be open", () => {
    expect(countsAsPresent("quests", { title: "t", status: "open" })).toBe(
      true,
    );
    expect(countsAsPresent("quests", { title: "t", status: "completed" })).toBe(
      false,
    );
    // The same completed record on another lens still counts.
    expect(countsAsPresent("events", { title: "t", status: "completed" })).toBe(
      true,
    );
  });

  it("Gun graph metadata never lights a cell (the false-positive bug)", () => {
    // The exact junk observed replaying at a prod cell's quests lens: a HAM
    // state fragment under key ">" and a soul ref under key "true".
    expect(looksLikeRecord({ true: 1730498418239 })).toBe(false);
    expect(looksLikeRecord({ "#": true })).toBe(false);
    expect(looksLikeRecord([1, 2])).toBe(false);
    expect(looksLikeRecord({ id: "q1" })).toBe(true);
    expect(looksLikeRecord({ title: "t" })).toBe(true);
    expect(countsAsPresent("quests", { true: 1730498418239 })).toBe(false);
    expect(countsAsPresent("library", { "#": true })).toBe(false);
  });
});

describe("itemLabel", () => {
  it("prefers title, then name, then falls through the field chain", () => {
    expect(itemLabel({ title: "Fix roof", name: "n" })).toBe("Fix roof");
    expect(itemLabel({ name: "Ada" })).toBe("Ada");
    expect(itemLabel({ text: "hello\nworld" })).toBe("hello");
  });

  it("truncates long lines and falls back to the id", () => {
    expect(itemLabel({ description: "x".repeat(120) })).toHaveLength(80);
    expect(itemLabel({ id: 42 })).toBe("42");
    expect(itemLabel(null)).toBe("");
  });
});
