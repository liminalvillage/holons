// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { unitHue, unitHueMap } from "./unithues";

describe("unitHue", () => {
  it("is a function of the name alone", () => {
    expect(unitHue("USD")).toBe(unitHue("usd"));
    expect(unitHue(" eur ")).toBe(unitHue("EUR"));
    expect(unitHueMap(["USD", "EUR"]).get("USD")).toBe(
      unitHueMap(["EUR", "kg", "USD"]).get("USD"),
    );
  });
  it("gives well-known currencies and units their own fixed colours", () => {
    const known = [
      "usd",
      "eur",
      "gbp",
      "chf",
      "btc",
      "hours",
      "kudos",
      "credits",
    ];
    expect(new Set(known.map(unitHue)).size).toBe(known.length);
    expect(unitHue("euro")).toBe(unitHue("EUR"));
  });
  it("puts the units boards commonly carry on different hues", () => {
    const names = ["tree", "cooking", "l", "pack", "kg", "lends", "evo", "oil"];
    const hue = (c: string) => c.match(/^hsl\((\d+)/)![1];
    expect(new Set(names.map((n) => hue(unitHue(n)))).size).toBe(names.length);
  });
});
