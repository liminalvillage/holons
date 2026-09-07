// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The lens layer's pure pieces: zoom band alignment with the dashboard map,
// the persisted presence-cache codec (dashboard row format + TTL), the
// presence rule per lens, and the panel's item labelling.

import { describe, it, expect } from "vitest";
import {
  cellToBoundary,
  getResolution,
  isValidCell,
  latLngToCell,
} from "h3-js";
import {
  LENSES,
  countsAsPresent,
  formatDetailValue,
  itemDetails,
  globalCells,
  isLensId,
  itemLabel,
  arcDegrees,
  canAddToCell,
  cellRing,
  headlineField,
  lensColor,
  lensScaffold,
  newLensItem,
  looksLikeRecord,
  paddedViewBox,
  parsePresence,
  PRESENCE_TTL_MS,
  resolutionToZoom,
  rimFade,
  serializePresence,
  viewportCells,
  zoomToResolution,
  type ViewBox,
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

  it("malformed emissions never light a cell", () => {
    // Shapes without any identity/content field — the junk a legacy graph
    // once replayed at a prod cell — must not count as records.
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

describe("itemDetails", () => {
  const iso = (d: Date) => d.toISOString();

  it("orders the well-known fields first and formats them for people", () => {
    const rows = itemDetails(
      {
        id: "q1",
        title: "Fix the pump",
        description: "The well pump\n\nneeds a new seal.",
        status: "ongoing",
        when: "2026-09-02T10:00:00.000Z",
        location: "Barn",
        participants: [{ id: 1, name: "Ada" }, { username: "bob" }],
        initiator: { first_name: "Cy" },
        created: "2026-08-01T00:00:00.000Z",
        picture: "http://x/y.png",
        _deleted: false,
        _meta: { anything: 1 },
      },
      { formatDate: iso },
    );
    expect(rows.map((r) => r.key)).toEqual([
      "status",
      "description",
      "when",
      "location",
      "participants",
      "initiator",
      "created",
    ]);
    expect(rows.find((r) => r.key === "description")?.value).toBe(
      "The well pump needs a new seal.",
    );
    expect(rows.find((r) => r.key === "when")?.value).toBe(
      "2026-09-02T10:00:00.000Z",
    );
    expect(rows.find((r) => r.key === "participants")?.value).toBe(
      "2 · Ada, bob",
    );
    expect(rows.find((r) => r.key === "initiator")?.value).toBe("Cy");
  });

  it("never repeats the headline field as a row", () => {
    // An announcement's headline IS its text — no `title`.
    const rows = itemDetails({ id: 1, text: "Market on Sunday", chat: "c" });
    expect(itemLabel({ text: "Market on Sunday" })).toBe("Market on Sunday");
    expect(rows.find((r) => r.key === "description")).toBeUndefined();
    expect(rows).toEqual([]);
  });

  it("folds amount + currency, and names the origin holon", () => {
    const rows = itemDetails({
      id: "e1",
      description: "Seeds",
      amount: 12.5,
      currency: "EUR",
      paidBy: "ada",
      splitWith: ["ada", "bob"],
      _holon: "-100123",
    });
    expect(rows).toEqual([
      { key: "amount", value: "12.5 EUR" },
      { key: "paidBy", value: "ada" },
      { key: "splitWith", value: "2 · ada, bob" },
      { key: "origin", value: "-100123" },
    ]);
  });

  it("appends leftover scalar fields alphabetically, skipping graph plumbing", () => {
    const rows = itemDetails({
      id: "x",
      name: "Thing",
      zeta: "last",
      alpha: 3,
      ok: true,
      nested: { deep: 1 }, // unknown objects are not rows
      "#": "soul",
      ">": { name: 1 },
      _: { ">": {} },
      _hidden: "no",
    });
    expect(rows).toEqual([
      { key: "alpha", value: "3" },
      { key: "ok", value: "✓" },
      { key: "zeta", value: "last" },
    ]);
  });

  it("drops fields that merely echo the headline, and reads primaryUrl as the link", () => {
    const rows = itemDetails({
      id: "p1",
      title: "Italy: Casa Selva",
      url: "", // an empty alias must not claim the row
      name: "Italy: Casa Selva",
      description: "Italy: Casa Selva",
      primary_url: "https://casaselva.earth",
      geolocation: { lat: 42.85123, lon: 13.5789 },
      region: "Italy",
    });
    expect(rows).toEqual([
      { key: "location", value: "42.8512, 13.5789" },
      { key: "link", value: "https://casaselva.earth" },
      { key: "region", value: "Italy" },
    ]);
  });

  it("caps long values", () => {
    const long = "x".repeat(1000);
    const rows = itemDetails(
      { title: "t", description: long, category: long },
      { maxLength: 100 },
    );
    expect(rows.find((r) => r.key === "description")?.value).toHaveLength(100);
    expect(rows.find((r) => r.key === "category")?.value).toHaveLength(25);
  });

  it("handles junk gracefully", () => {
    expect(itemDetails(null)).toEqual([]);
    expect(itemDetails("str")).toEqual([]);
    expect(itemDetails([1, 2])).toEqual([]);
    expect(formatDetailValue(1725270000000, { formatDate: iso })).toBe(
      "2024-09-02T09:40:00.000Z",
    );
  });
});

describe("quick add", () => {
  it("offers every lens whose record a map tap can honestly start", () => {
    const addable = LENSES.map((l) => l.id).filter(canAddToCell);
    expect(addable).toEqual([
      "quests",
      "needs",
      "offers",
      "communities",
      "organizations",
      "projects",
      "currencies",
      "people",
      "holons",
      "events",
      "library",
      "roles",
      "announcements",
      "expenses",
      "checklists",
      "canvases",
    ]);
    // Both name a SECOND person the map can't know, and neither record means
    // anything without them.
    for (const lens of ["appreciations", "rea_events"] as const) {
      expect(canAddToCell(lens)).toBe(false);
      expect(headlineField(lens)).toBeNull();
    }
  });

  it("knows where each lens keeps the line the panel lists it by", () => {
    expect(headlineField("projects")).toBe("name");
    expect(headlineField("quests")).toBe("title");
    expect(headlineField("announcements")).toBe("content");
    expect(headlineField("expenses")).toBe("description");
  });

  it("carries the constants a lens's record needs whatever is typed", () => {
    expect(lensScaffold("events")).toEqual({ type: "event" });
    expect(lensScaffold("library")).toEqual({ type: "other" });
    expect(lensScaffold("checklists")).toEqual({
      type: "checklist",
      items: [],
    });
    expect(lensScaffold("projects")).toEqual({});
  });

  it("builds a bare headline record, scaffolding and all", () => {
    expect(newLensItem("projects", "  Orchard  ", "a1")).toEqual({
      id: "a1",
      name: "Orchard",
    });
    expect(newLensItem("events", "Market", "e1")).toEqual({
      id: "e1",
      title: "Market",
      type: "event",
    });
  });

  it("reads back as its own label, and counts as present", () => {
    for (const lens of LENSES.map((l) => l.id).filter(canAddToCell)) {
      const item = newLensItem(lens, "A thing", "x");
      expect(item, lens).not.toBeNull();
      expect(itemLabel(item), lens).toBe("A thing");
      expect(countsAsPresent(lens, item), lens).toBe(true);
    }
  });

  it("builds nothing from a blank line, a missing id, or a lens it can't add", () => {
    expect(newLensItem("projects", "   ", "a1")).toBeNull();
    expect(newLensItem("projects", "Orchard", "")).toBeNull();
    expect(newLensItem("appreciations", "Thanks", "x1")).toBeNull();
  });
});

describe("cell outlines", () => {
  const corners = (cell: string) => cellToBoundary(cell, true).length;

  it("leaves a fine cell as its bare vertices", () => {
    // A res-9 edge is ~200 m — far under the half-degree step, so nothing
    // is inserted and the ring is the cell's own corners (six, or seven
    // where a vertex lands on an icosahedron edge) plus the closing point.
    const cell = latLngToCell(44.4949, 11.3426, 9);
    const ring = cellRing(cell);
    expect(ring).toHaveLength(corners(cell) + 1);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("walks a coarse cell's long edges along the globe", () => {
    const cell = latLngToCell(70, 20, 1);
    const ring = cellRing(cell);
    expect(ring.length).toBeGreaterThan(corners(cell) + 1);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    // Every inserted point sits ON the arc: consecutive points are never
    // further apart than the step, and no point strays off the boundary.
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1] as [number, number];
      const b = ring[i] as [number, number];
      expect(arcDegrees(a, b)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it("puts an edge's midpoint on the arc, not on the chord", () => {
    // The bug this fixes: a straight lng/lat chord across a long edge bows
    // the wrong way once Mercator stretches the latitudes.
    const [a, b] = cellToBoundary(latLngToCell(70, 20, 1), true) as Array<
      [number, number]
    >;
    const mid = cellRing(latLngToCell(70, 20, 1), arcDegrees(a, b) / 2)[1] as [
      number,
      number,
    ];
    const chordLat = (a[1] + b[1]) / 2;
    expect(mid[1]).not.toBeCloseTo(chordLat, 6);
    // ...and it really is equidistant from the two corners.
    expect(arcDegrees(a, mid)).toBeCloseTo(arcDegrees(mid, b), 6);
  });

  it("keeps a cell straddling the antimeridian in one piece", () => {
    const ring = cellRing(latLngToCell(0, 179.9, 3));
    const lngs = ring.map(([lng]) => lng);
    expect(Math.max(...lngs) - Math.min(...lngs)).toBeLessThan(180);
    for (let i = 1; i < ring.length; i++)
      expect(Math.abs(ring[i][0] - ring[i - 1][0])).toBeLessThan(180);
  });
});

describe("grid coverage", () => {
  /** Does the fill over a padded viewport leave any of it uncovered? */
  function bald(view: ViewBox, res: number, steps = 9): string[] {
    const covering = new Set(viewportCells(paddedViewBox(view, res), res));
    const missed: string[] = [];
    for (let i = 0; i <= steps; i++)
      for (let j = 0; j <= steps; j++) {
        const lat = view.south + ((view.north - view.south) * i) / steps;
        const lng = view.west + ((view.east - view.west) * j) / steps;
        const cell = latLngToCell(lat, lng, res);
        if (!covering.has(cell)) missed.push(`${lat},${lng}`);
      }
    return missed;
  }

  // The whole point: every visible spot sits inside a drawn hexagon. The
  // bare viewport fails this — h3 keeps only cells CENTRED inside it, so
  // the ones straddling the edge (and the corners especially) go missing.
  it.each([
    [
      "Bologna, city zoom",
      { west: 11.2, south: 44.4, east: 11.5, north: 44.6 },
      8,
    ],
    ["Europe, country zoom", { west: 0, south: 40, east: 20, north: 55 }, 3],
    ["the far north", { west: 10, south: 70, east: 30, north: 78 }, 3],
    [
      "a sliver of a view",
      { west: 11.34, south: 44.49, east: 11.35, north: 44.5 },
      11,
    ],
  ])("covers %s edge to edge", (_name, view, res) => {
    expect(bald(view as ViewBox, res)).toEqual([]);
  });

  it("grows the margin with the size of the cell", () => {
    const view = { west: 0, south: 40, east: 20, north: 55 };
    const wide = paddedViewBox(view, 1);
    const tight = paddedViewBox(view, 9);
    expect(wide.north - wide.south).toBeGreaterThan(tight.north - tight.south);
    // Even the finest cells still get the tenth-of-a-view head start.
    expect(tight.north).toBeCloseTo(view.north + 1.5, 6);
  });

  it("never pads a wide viewport past the half-globe line", () => {
    const near = paddedViewBox(
      { west: -89, south: -10, east: 89, north: 10 },
      0,
    );
    expect(near.east - near.west).toBeLessThan(180);
    // Already global: h3 has given up on the fill anyway, so no margin.
    const global = paddedViewBox(
      { west: -180, south: -80, east: 180, north: 80 },
      0,
    );
    expect(global.east - global.west).toBe(360);
  });
});

describe("rim fade", () => {
  it("leaves the whole map at full strength but for a band at the rim", () => {
    expect(rimFade(0)).toBe(1); // the middle
    expect(rimFade(0.8)).toBe(1); // most of the way out, still full
    expect(rimFade(1)).toBeGreaterThan(0); // ON the edge, still drawn
    expect(rimFade(1)).toBeLessThan(1);
  });

  it("keeps drawing the cells that straddle the edge, then stops", () => {
    expect(rimFade(1.1)).toBeGreaterThan(0);
    expect(rimFade(1.2)).toBe(0);
  });

  it("thins monotonically across the band", () => {
    let prev = 1;
    for (let e = 0.86; e <= 1.2; e += 0.02) {
      const v = rimFade(e);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });
});
