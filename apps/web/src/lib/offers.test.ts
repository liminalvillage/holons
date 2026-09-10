// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { createOffer, reserveOffer, stockOfferId } from "@holons/core/offers";
import {
  buildOfferBoard,
  contentionMeter,
  distanceLabel,
  groupByCategory,
  scaleById,
  scaleOptions,
  splitByOrigin,
} from "./offers";

const HEX = "891f1d48b4bffff";
const initiator = { id: 7, username: "ada" };
const offer = (
  id: string,
  holonId: string,
  quantity: number,
  extra: Record<string, unknown> = {},
) => ({
  ...createOffer({
    holonId,
    initiator,
    title: id,
    category: "food",
    supply: { itemId: "flour", quantity, unit: "kg" },
    id,
    now: 0,
  }),
  ...extra,
});
const need = (
  id: string,
  holonId: string,
  quantity: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  type: "need",
  status: "requested",
  title: id,
  category: "food",
  holonId,
  initiator: { id: 9 },
  stock: { itemId: "flour", quantity, unit: "kg" },
  responses: [],
  ...extra,
});
const fromPartner = (rec: object, origin: string) => ({
  ...rec,
  _federation: { origin },
});
const base = {
  holonId: "a",
  viewerId: "7",
  partners: { a: ["b"] },
  hexOf: { a: HEX },
  now: 1,
};

describe("scaleOptions", () => {
  it("lists the holon, the federation, then the home cell and the ladder rungs above it, labelled by width", () => {
    const opts = scaleOptions(HEX, 2);
    expect(opts.map((o) => o.id)).toEqual([
      "holon",
      "partners",
      "cell:0",
      "cell:1",
      "cell:2",
      "cell:3",
      "cell:4",
    ]);
    expect(opts[1].label).toBe("Federation (2)");
    expect(opts[2].scale).toEqual({ kind: "cell", cell: HEX, level: 0 });
    expect(opts.slice(2).map((o) => o.label)).toEqual([
      "≈ 400 m",
      "≈ 1.1 km",
      "≈ 7.4 km",
      "≈ 52 km",
      "≈ 365 km",
    ]);
    expect(scaleOptions(null, 0).map((o) => o.id)).toEqual([
      "holon",
      "partners",
    ]);
    expect(scaleById(opts, "nope")).toEqual({ kind: "holon" });
  });
});

describe("splitByOrigin", () => {
  it("keeps own records apart from partner copies and holograms", () => {
    const out = splitByOrigin(
      [
        { id: "x" },
        fromPartner({ id: "y" }, "b"),
        { id: "z", _hologram: { isHologram: true, sourceHolon: "c" } },
      ],
      "a",
    );
    expect(out.own.map((r) => (r as { id: string }).id)).toEqual(["x"]);
    expect(out.partner.map((r) => (r as { id: string }).id)).toEqual([
      "y",
      "z",
    ]);
  });
});

describe("buildOfferBoard", () => {
  it("at holon scale an own offer meets an own need at cost 0; the provider can offer it", () => {
    const board = buildOfferBoard({
      ...base,
      scale: { kind: "holon" },
      quests: [
        offer("o", "a", 5),
        need("n", "a", 3),
        fromPartner(need("pn", "b", 3), "b"),
      ],
    });
    expect(board.supply.map((c) => c.key)).toEqual(["o"]);
    expect(board.demand.map((c) => c.key)).toEqual(["n"]); // the partner's need is out of scale
    expect(board.matches).toHaveLength(1);
    const m = board.matches[0];
    expect(m.leg).toMatchObject({
      offerId: "o",
      needId: "n",
      quantity: 3,
      cost: 0,
    });
    expect(m.role).toBe("provider");
    expect(m.state).toBe("proposed");
    expect(m.distanceLabel).toBe("here");
    expect(m.canAccept).toBe(true);
    expect(board.unused).toBe(2);
  });

  it("at partner scale the copy counts, priced by hops", () => {
    const board = buildOfferBoard({
      ...base,
      scale: { kind: "partners" },
      quests: [offer("o", "a", 5), fromPartner(need("pn", "b", 3), "b")],
    });
    expect(board.demand[0]).toMatchObject({
      key: "b::pn",
      own: false,
      source: "partner",
      matchable: true,
    });
    expect(board.matches[0].distanceLabel).toBe("1 hop");
    expect(board.matches[0].leg.cost).toBe(1);
  });

  it("at cell scale a record reached as partner copy AND cell hologram is one card, and strangers are priced by cells", () => {
    const stranger = {
      ...need("sn", "c", 2, { hex: "891f1d48b4bffff" }),
      _hologram: { isHologram: true, sourceHolon: "c" },
    };
    const pnCopy = fromPartner(need("pn", "b", 3), "b");
    const pnHolo = {
      ...need("pn", "b", 3),
      _hologram: { isHologram: true, sourceHolon: "b" },
    };
    const board = buildOfferBoard({
      ...base,
      scale: { kind: "cell", cell: HEX, level: 0 },
      quests: [offer("o", "a", 10), pnCopy],
      cell: {
        cell: HEX,
        offers: [],
        needs: [pnHolo, stranger] as never,
        holons: ["b", "c"],
      },
    });
    expect(board.demand.map((c) => c.key).sort()).toEqual(["b::pn", "c::sn"]);
    const toStranger = board.matches.find((m) => m.leg.needId === "sn")!;
    expect(toStranger.leg.cost).toBe(1); // same cell: penalty only
    expect(toStranger.distanceLabel).toBe("same cell");
    expect(board.holons).toEqual(["a", "b", "c"]);
  });

  it("roles and states follow the need's responses", () => {
    const o = offer("o", "a", 5);
    const held = reserveOffer(o, {
      needId: "n",
      needHolonId: "b",
      responseId: "p1",
      quantity: 2,
      id: "r1",
    }).offer;
    const responded = fromPartner(
      need("n", "b", 2, {
        status: "offered",
        responses: [
          {
            id: "p1",
            responder: { id: 7, holonId: "a" },
            createdAt: "x",
            offerId: "o",
          },
        ],
      }),
      "b",
    );
    const board = buildOfferBoard({
      ...base,
      scale: { kind: "partners" },
      quests: [held, responded],
    });
    expect(board.matches).toHaveLength(1);
    expect(board.matches[0]).toMatchObject({
      committed: true,
      state: "responded",
      role: "provider",
      canAccept: false,
    });
    // Seen from the requester's board, the same need is theirs to accept.
    const theirs = buildOfferBoard({
      holonId: "b",
      viewerId: "9",
      partners: { a: ["b"] },
      hexOf: {},
      now: 1,
      scale: { kind: "partners" },
      quests: [
        fromPartner(held, "a"),
        { ...responded, _federation: undefined },
      ],
    });
    expect(theirs.matches[0]).toMatchObject({
      role: "requester",
      state: "responded",
      canAccept: true,
    });
    const claimed = buildOfferBoard({
      ...base,
      scale: { kind: "partners" },
      quests: [
        held,
        { ...responded, status: "claimed", claimedResponseId: "p1" },
      ],
    });
    expect(claimed.matches).toHaveLength(1);
    expect(claimed.matches[0].state).toBe("claimed");
  });

  it("a provider cannot serve their own need; observers never accept", () => {
    const mine = need("n", "a", 2, { initiator: { id: 7 } });
    const board = buildOfferBoard({
      ...base,
      scale: { kind: "holon" },
      quests: [offer("o", "a", 5), mine],
    });
    expect(board.matches[0].canAccept).toBe(false);
    const observer = buildOfferBoard({
      ...base,
      holonId: "z",
      viewerId: "1",
      scale: { kind: "partners" },
      partners: { a: ["b"], b: ["z"], a2: ["z"] },
      quests: [
        fromPartner(offer("o", "a", 5), "a"),
        fromPartner(need("n", "b", 2), "b"),
      ],
    });
    expect(observer.matches[0].role).toBe("observer");
    expect(observer.matches[0].canAccept).toBe(false);
  });

  it("legacy offers and requests still render: one unit, not matchable", () => {
    const legacyOffer = {
      id: "lo",
      type: "offer",
      title: "Bike",
      transaction_type: ["borrow-lend"],
      initiator: { id: 7 },
    };
    const request = {
      id: "rq",
      type: "request",
      title: "Ladder",
      initiator: { id: 9 },
    };
    const board = buildOfferBoard({
      ...base,
      scale: { kind: "holon" },
      quests: [legacyOffer, request],
    });
    expect(board.supply[0]).toMatchObject({
      key: "lo",
      remaining: 1,
      statusLabel: "Open",
      mine: true,
      auto: false,
    });
    expect(board.supply[0].offer.mode).toBe("lend");
    expect(board.demand[0]).toMatchObject({
      key: "rq",
      legacy: true,
      matchable: false,
      statusLabel: "Request",
    });
    expect(board.matches).toEqual([]);
  });

  it("flags auto offers and the contention per category", () => {
    const auto = offer(stockOfferId("flour"), "a", 2, {
      source: { kind: "stock", itemId: "flour" },
    });
    const board = buildOfferBoard({
      ...base,
      scale: { kind: "holon" },
      quests: [auto, need("n", "a", 5)],
    });
    expect(board.supply[0].auto).toBe(true);
    expect(board.contention[0]).toMatchObject({
      category: "food",
      supply: 2,
      demand: 5,
      shortage: 3,
      blocked: 0.6,
    });
    expect(board.unmet).toBe(3);
  });
});

describe("meters and labels", () => {
  it("contention runs 0 → 1 with price, full when unmet", () => {
    expect(contentionMeter(0)).toBe(0);
    expect(contentionMeter(1)).toBeGreaterThan(0);
    expect(contentionMeter(1)).toBeLessThan(contentionMeter(10));
    expect(contentionMeter(1000)).toBe(1);
    expect(contentionMeter(Infinity)).toBe(1);
  });
  it("distance reads as hops for partners and cells for strangers", () => {
    expect(distanceLabel(0, 0)).toBe("here");
    expect(distanceLabel(2, 2)).toBe("2 hops");
    expect(distanceLabel(4, Infinity)).toBe("3 cells away");
    expect(distanceLabel(Infinity, Infinity)).toBe("unreachable");
  });
  it("groups cards by category, blanks last as uncategorised", () => {
    const groups = groupByCategory([
      { offer: offer("a", "a", 1) },
      { offer: { ...offer("b", "a", 1), category: "" } },
    ]);
    expect(groups.map((g) => g.category)).toEqual(["food", "uncategorised"]);
  });
});
