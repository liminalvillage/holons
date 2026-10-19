// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
  addressHref,
  hrefFor,
  parseTarget,
  routeOf,
  searchHref,
  withParam,
} from "./urls";

describe("hrefFor", () => {
  it("puts people and unclaimed seats under /p, holons under /h", () => {
    expect(routeOf("person")).toBe("p");
    expect(routeOf("placeholder")).toBe("p");
    expect(routeOf("fund")).toBe("h");
    expect(routeOf("project")).toBe("h");
    expect(routeOf("pot")).toBe("h");
    expect(hrefFor({ id: "holon_abc", kind: "fund" })).toBe("/h/holon_abc");
    expect(hrefFor({ id: "235114395", kind: "person" })).toBe("/p/235114395");
  });

  it("encodes what an id may hold", () => {
    expect(hrefFor({ id: "artisan:9/x", kind: "placeholder" })).toBe(
      "/p/artisan%3A9%2Fx",
    );
    expect(hrefFor({ id: "-1001234", kind: "project" })).toBe("/h/-1001234");
  });

  it("carries the unit and the depth along, and nothing else", () => {
    const from = new URLSearchParams("unit=EVO&up=2&pot=holon_x&q=secret");
    expect(hrefFor({ id: "holon_abc", kind: "fund" }, from)).toBe(
      "/h/holon_abc?unit=EVO&up=2",
    );
    expect(
      hrefFor({ id: "holon_abc", kind: "fund" }, new URLSearchParams()),
    ).toBe("/h/holon_abc");
  });
});

describe("other addresses", () => {
  it("lower-cases a wallet address", () => {
    expect(addressHref(" 0xAbC0000000000000000000000000000000000001 ")).toBe(
      "/a/0xabc0000000000000000000000000000000000001",
    );
  });

  it("builds a search link", () => {
    expect(searchHref("")).toBe("/search");
    expect(searchHref("dream factory")).toBe("/search?q=dream+factory");
    expect(searchHref("", "fund")).toBe("/search?kind=fund");
  });

  it("sets and drops one view parameter", () => {
    const url = new URL("https://x.test/h/holon_a?unit=EVO");
    expect(withParam(url, "up", "2")).toBe("/h/holon_a?unit=EVO&up=2");
    expect(withParam(url, "unit", null)).toBe("/h/holon_a");
  });
});

describe("parseTarget", () => {
  it("knows an address, an id and plain words apart", () => {
    expect(parseTarget("0xAbC0000000000000000000000000000000000001")).toEqual({
      type: "address",
      value: "0xabc0000000000000000000000000000000000001",
    });
    expect(parseTarget("npub1qqqsyqcyq5rqwzqfpg9scrgwpugpzysn")).toMatchObject({
      type: "id",
    });
    expect(parseTarget("a".repeat(64))).toMatchObject({ type: "id" });
    expect(parseTarget("235114395")).toMatchObject({ type: "id" });
    expect(parseTarget("-1001234567890")).toMatchObject({ type: "id" });
    expect(parseTarget("holon_gys43bbqut5rr7ka")).toMatchObject({ type: "id" });
    expect(parseTarget("artisan:42")).toMatchObject({ type: "id" });
    expect(parseTarget(" Dream Factory ")).toEqual({
      type: "query",
      value: "Dream Factory",
    });
    expect(parseTarget("2024")).toEqual({ type: "query", value: "2024" });
    expect(parseTarget("https://example.org/x")).toMatchObject({
      type: "query",
    });
    expect(parseTarget("   ")).toBeNull();
  });
});
