// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  buildStockEvent,
  buildStockTransfer,
  createStockItemSpec,
} from "@holons/core/inventory";
import {
  buildStockBoard,
  filterReorder,
  filterShelf,
  fmtQty,
  groupShelf,
  historyOf,
  shelfCategories,
  shelfRows,
  splitSpecs,
} from "./stock";

const actor = { id: 7, username: "ada" };
const H = "home";
const P = "partner";

const spec = (name: string, extra: Record<string, unknown> = {}) =>
  createStockItemSpec({
    name,
    category: "food",
    unit: "kg",
    now: 0,
    ...extra,
  });

describe("splitSpecs", () => {
  it("keeps our specs apart from each partner's", () => {
    const sets = splitSpecs([
      spec("Flour"),
      { ...spec("Flour"), _federation: { origin: P, sourceLens: "stock" } },
      {
        ...spec("Rice"),
        _federation: { origin: "other", sourceLens: "stock" },
      },
      { type: "junk" },
    ]);
    expect(sets.own.map((s) => s.id)).toEqual(["flour"]);
    expect(Object.keys(sets.partners).sort()).toEqual(["other", P]);
    expect(sets.partners[P][0].id).toBe("flour");
  });
});

describe("shelfRows", () => {
  const specs = [
    spec("Flour", { target: 20, min: 5 }),
    spec("Rice"),
    spec("Oil", { target: 4 }),
  ];
  const events = [
    buildStockEvent({
      holonId: H,
      kind: "stock:produced",
      itemId: "flour",
      quantity: 3,
      unit: "kg",
      actor,
    }),
    buildStockEvent({
      holonId: H,
      kind: "stock:produced",
      itemId: "rice",
      quantity: 8,
      unit: "kg",
      actor,
    }),
    buildStockTransfer({
      fromHolonId: P,
      toHolonId: H,
      itemId: "oil",
      quantity: 2,
      unit: "l",
      actor,
      status: "pending",
    }),
  ];

  it("reads status and fill per row, keeping empty rows", () => {
    const board = buildStockBoard({
      holonId: H,
      specs,
      events,
      needs: [],
      federated: [],
      partners: [],
    });
    const rows = shelfRows(specs, board.levels);
    expect(rows.map((r) => [r.spec.id, r.onhand, r.status, r.fill])).toEqual([
      ["flour", 3, "low", 0.15],
      ["oil", 0, "empty", 0],
      ["rice", 8, "ok", 1],
    ]);
    const oil = rows.find((r) => r.spec.id === "oil")!;
    expect(oil.incoming).toBe(2);
    expect(oil.inFlight).toBe(true);
  });

  it("groups by category in spec order", () => {
    const rows = shelfRows(
      [spec("Screws", { category: "hardware" }), ...specs],
      [],
    );
    expect(groupShelf(rows).map((g) => [g.category, g.rows.length])).toEqual([
      ["food", 3],
      ["hardware", 1],
    ]);
  });
});

describe("historyOf", () => {
  it("lists an item's events newest first with signed deltas and who", () => {
    const events = [
      buildStockEvent({
        holonId: H,
        kind: "stock:produced",
        itemId: "flour",
        quantity: 10,
        unit: "kg",
        actor,
        now: 1000,
        note: "harvest",
      }),
      buildStockEvent({
        holonId: H,
        kind: "stock:consumed",
        itemId: "flour",
        quantity: 4,
        unit: "kg",
        actor,
        now: 3000,
      }),
      buildStockTransfer({
        fromHolonId: H,
        toHolonId: P,
        itemId: "flour",
        quantity: 1,
        unit: "kg",
        actor,
        now: 2000,
        status: "pending",
      }),
      buildStockEvent({
        holonId: H,
        kind: "stock:produced",
        itemId: "rice",
        quantity: 1,
        unit: "kg",
        actor,
        now: 4000,
      }),
    ];
    const lines = historyOf(events, H, "flour");
    expect(
      lines.map((l) => [l.at, l.kind, l.delta, l.who, l.pending, l.note]),
    ).toEqual([
      [3000, "stock:consumed", -4, "ada", false, ""],
      [2000, "stock:transferred", -1, P, true, ""],
      [1000, "stock:produced", 10, "ada", false, "harvest"],
    ]);
  });
});

describe("buildStockBoard", () => {
  it("nets our needs, derives the reorder, and plans moves from the nearest partner", () => {
    const specs = [spec("Flour", { target: 20, min: 2 })];
    const events = [
      buildStockEvent({
        holonId: H,
        kind: "stock:produced",
        itemId: "flour",
        quantity: 4,
        unit: "kg",
        actor,
      }),
    ];
    const needs = [
      {
        type: "need",
        status: "open",
        category: "food",
        stock: { itemId: "flour", quantity: 6 },
      },
    ];
    const near = {
      id: P,
      name: "Near",
      specs: [spec("Flour", { min: 1 })],
      events: [
        buildStockEvent({
          holonId: P,
          kind: "stock:produced",
          itemId: "flour",
          quantity: 5,
          unit: "kg",
          actor,
        }),
      ],
      federated: [H],
    };
    const far = {
      id: "far",
      name: "Far",
      specs: [spec("Flour")],
      events: [
        buildStockEvent({
          holonId: "far",
          kind: "stock:produced",
          itemId: "flour",
          quantity: 50,
          unit: "kg",
          actor,
        }),
      ],
      federated: [P],
    };
    const board = buildStockBoard({
      holonId: H,
      specs,
      events,
      needs,
      federated: [P],
      partners: [near, far],
    });
    expect(board.levels[0]).toMatchObject({
      onhand: 4,
      reserved: 4,
      available: 0,
    });
    // demand 6 against 4 on hand (the reservation is for this same need)
    expect(board.scarcity).toEqual([
      {
        holonId: H,
        category: "food",
        demand: 6,
        available: 4,
        shortage: 2,
        blocked: 0.333,
      },
    ]);
    // target 20 − onhand 4 + reserved 4 = 20 to buy
    expect(board.reorder.map((l) => [l.itemId, l.quantity])).toEqual([
      ["flour", 20],
    ]);
    expect(board.plan).toEqual([
      { category: "food", from: P, to: H, quantity: 2, cost: 1 },
    ]);
    expect(board.partnerLevels[P][0].onhand).toBe(5);
  });
});

describe("fmtQty", () => {
  it("formats units and plain counts", () => {
    expect(fmtQty(2.5, "kg")).toBe("2.5 kg");
    expect(fmtQty(60, "one")).toBe("60×");
    expect(fmtQty(1.2345, "l")).toBe("1.23 l");
  });
});

describe("filterShelf / filterReorder / shelfCategories", () => {
  const specs = [
    spec("Flour", { target: 20 }),
    spec("Olive oil"),
    spec("Screws", { category: "workshop", unit: "one", target: 50 }),
  ];
  const rows = shelfRows(specs, []);

  it("passes the same array through on an empty query", () => {
    expect(filterShelf(rows, "  ")).toBe(rows);
  });
  it("matches names, case-insensitively", () => {
    expect(filterShelf(rows, "OIL").map((r) => r.spec.name)).toEqual([
      "Olive oil",
    ]);
  });
  it("matches categories", () => {
    expect(filterShelf(rows, "workshop").map((r) => r.spec.name)).toEqual([
      "Screws",
    ]);
  });
  it("needs every term: category and name together", () => {
    expect(filterShelf(rows, "food fl").map((r) => r.spec.name)).toEqual([
      "Flour",
    ]);
    expect(filterShelf(rows, "workshop flour")).toEqual([]);
  });
  it("narrows the reorder list the same way", () => {
    const board = buildStockBoard({
      holonId: H,
      specs,
      events: [],
      needs: [],
      federated: [],
      partners: [],
    });
    expect(board.reorder.map((l) => l.itemId).sort()).toEqual([
      "flour",
      "screws",
    ]);
    expect(filterReorder(board.reorder, "work").map((l) => l.itemId)).toEqual([
      "screws",
    ]);
    expect(filterReorder(board.reorder, "")).toBe(board.reorder);
  });
  it("lists the shelf's categories, sorted and unique", () => {
    expect(shelfCategories(specs)).toEqual(["food", "workshop"]);
  });
});
