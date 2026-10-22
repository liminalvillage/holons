// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  cardFromSearch,
  mergeTap,
  offerUrl,
  stockItemFromSearch,
  stockItemUrl,
  withoutCard,
  withoutStockItem,
} from "./stocklink";

describe("stockItemUrl", () => {
  it("names the holon segment, the stock tab and the item", () => {
    expect(stockItemUrl("https://kiosk.holons.io", "liminal", "flour")).toBe(
      "https://kiosk.holons.io/liminal/stock?item=flour",
    );
  });
  it("encodes both segments and tolerates a trailing slash on the origin", () => {
    expect(stockItemUrl("http://localhost:5173/", "-100123", "olive oil")).toBe(
      "http://localhost:5173/-100123/stock?item=olive%20oil",
    );
  });
});

describe("stockItemFromSearch", () => {
  it("reads the item and ignores the rest", () => {
    expect(stockItemFromSearch("?app=x&item=flour")).toBe("flour");
  });
  it("is null when absent or blank", () => {
    expect(stockItemFromSearch("")).toBeNull();
    expect(stockItemFromSearch("?item=%20")).toBeNull();
    expect(stockItemFromSearch("?holon=1")).toBeNull();
  });
});

describe("withoutStockItem", () => {
  it("drops only the item pointer", () => {
    expect(withoutStockItem("?app=x&item=flour")).toBe("?app=x");
    expect(withoutStockItem("?item=flour")).toBe("");
  });
});

describe("mergeTap", () => {
  it("sums taps", () => {
    expect(mergeTap(0, 1, 3)).toBe(1);
    expect(mergeTap(2, 1, 3)).toBe(3);
    expect(mergeTap(2, -1, 3)).toBe(1);
  });
  it("never takes more than the shelf holds", () => {
    expect(mergeTap(0, -1, 0)).toBe(0);
    expect(mergeTap(-3, -1, 3)).toBe(-3);
    expect(mergeTap(1, -1, 0)).toBe(0);
  });
});

describe("offer links", () => {
  it("share the grammar under their own param", () => {
    expect(offerUrl("https://k.io", "liminal", "offer-stock-flour")).toBe(
      "https://k.io/liminal/offers?offer=offer-stock-flour",
    );
    expect(cardFromSearch("?offer=o1&item=x", "offer")).toBe("o1");
    expect(withoutCard("?offer=o1&item=x", "offer")).toBe("?item=x");
  });
});
