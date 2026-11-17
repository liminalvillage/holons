// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
  ageOf,
  amount,
  clip,
  failure,
  isStale,
  pct,
  shortAddress,
  valueText,
} from "./format";

const MIN = 60_000;
const DAY = 86_400_000;

describe("pct", () => {
  it("never calls something that is there nothing", () => {
    expect(pct(0)).toBe("0%");
    expect(pct(-1)).toBe("0%");
    expect(pct(Number.NaN)).toBe("0%");
    expect(pct(0.004)).toBe("<0.01%");
    expect(pct(0.0149)).toBe("0.01%");
  });

  it("keeps the digits a share is told apart by", () => {
    expect(pct(2.9497)).toBe("2.95%");
    expect(pct(5)).toBe("5%");
    expect(pct(12.34)).toBe("12.3%");
    expect(pct(50)).toBe("50%");
    expect(pct(99.96)).toBe("100%");
    expect(pct(100)).toBe("100%");
  });
});

describe("amount", () => {
  it("writes an amount with its unit, to the precision its size deserves", () => {
    expect(amount(1234.5, "EVO")).toBe("1,235 EVO");
    expect(amount(12.345, "EVO")).toBe("12.35 EVO");
    expect(amount(0.01234, "ETH")).toBe("0.0123 ETH");
    expect(amount(3, "")).toBe("3");
    expect(amount(1234.5, "EUR", "it")).toMatch(/^1[.  ]?235 EUR$/);
  });

  it("reads a track's unit to choose percent or amount", () => {
    expect(valueText(25, "")).toBe("25%");
    expect(valueText(25, "EVO")).toBe("25 EVO");
  });
});

describe("ageOf", () => {
  const now = 1_800_000_000_000;
  it("counts in the largest unit that says something", () => {
    expect(ageOf(now - 30_000, now)).toEqual({ key: "age.now" });
    expect(ageOf(now + 5 * MIN, now)).toEqual({ key: "age.now" });
    expect(ageOf(now - 5 * MIN, now)).toEqual({ key: "age.minutes", n: 5 });
    expect(ageOf(now - 3 * 60 * MIN, now)).toEqual({ key: "age.hours", n: 3 });
    expect(ageOf(now - 47 * 60 * MIN, now)).toEqual({
      key: "age.hours",
      n: 47,
    });
    expect(ageOf(now - 9 * DAY, now)).toEqual({ key: "age.days", n: 9 });
  });

  it("is stale once a lunation's cut was missed", () => {
    expect(isStale(now - 30 * DAY, now)).toBe(false);
    expect(isStale(now - 36 * DAY, now)).toBe(true);
  });
});

describe("short forms", () => {
  it("shortens an address and clips a label", () => {
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe(
      "0x1234…5678",
    );
    expect(shortAddress("0x12")).toBe("0x12");
    expect(clip("Traditional Dream Factory", 12)).toBe("Traditional…");
    expect(clip("Short", 12)).toBe("Short");
    expect(clip("Anything", 1)).toBe("…");
  });
});

describe("failure", () => {
  it("adds the reason core gave", () => {
    expect(
      failure(
        "That did not go through.",
        new Error("A claim is already waiting"),
      ),
    ).toBe("That did not go through. A claim is already waiting.");
    expect(failure("Failed.", null)).toBe("Failed.");
    expect(failure("Failed.", new Error("Failed."))).toBe("Failed.");
  });
});

describe("pct in the reader's locale", () => {
  it("writes the decimal mark the locale uses", () => {
    expect(pct(0.13, "it")).toBe("0,13%");
    expect(pct(12.5, "es")).toBe("12,5%");
    expect(pct(0.13)).toBe("0.13%");
    expect(pct(0.001, "it")).toBe("<0,01%");
  });
});
