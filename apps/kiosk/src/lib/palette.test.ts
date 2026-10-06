// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { inkOn, luminance, readableOn, washOf } from "./palette";

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a)!, luminance(b)!].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// What accent-coloured text sits on (app.css) — the surfaces, then the
// post-its — by day and by night.
const DAY = [
  ...["#fffdf8", "#f7f4ec", "#efeadd", "#e3ddcd"],
  ...["#ffe79a", "#c4e8cd", "#c2e3f0", "#ffc7b8", "#ddd2f1", "#e6efa7"],
];
const NIGHT = [
  ...["#14181a", "#0d1012", "#1c2226", "#2c3539"],
  ...["#5a4a1e", "#214233", "#1d3a4a", "#5a2f27", "#3a3158", "#3b4521"],
];
// Every accent the caretaker can pick from a swatch, plus the extremes.
const ACCENTS = [
  "#0e6b66",
  "#3b6fb0",
  "#7a5cc0",
  "#c0567a",
  "#c47d2f",
  "#2f9e6b",
  "#ffe600",
  "#000000",
  "#ffffff",
];

describe("readableOn", () => {
  it("makes any accent readable as text on every surface of both palettes", () => {
    for (const accent of ACCENTS)
      for (const grounds of [DAY, NIGHT]) {
        const ink = readableOn(accent, grounds)!;
        for (const g of grounds)
          expect(contrast(ink, g), `${accent} on ${g}`).toBeGreaterThanOrEqual(
            4.5,
          );
      }
  });

  it("leaves a colour that already reads untouched", () => {
    expect(readableOn("#0b5350", DAY)).toBe("#0b5350");
  });

  it("moves toward white on dark grounds and toward black on light ones", () => {
    expect(luminance(readableOn("#0e6b66", NIGHT))).toBeGreaterThan(
      luminance("#0e6b66")!,
    );
    expect(luminance(readableOn("#ffe600", DAY))).toBeLessThan(
      luminance("#ffe600")!,
    );
  });

  it("declines anything that is not a literal colour", () => {
    expect(readableOn("var(--teal)", DAY)).toBeUndefined();
    expect(readableOn("#0e6b66", ["var(--card)"])).toBeUndefined();
    expect(readableOn("#0e6b66", [])).toBeUndefined();
  });
});

describe("washOf", () => {
  it("lifts a deep colour into the pastel range by day", () => {
    const wash = washOf("#1b2a6b", "light");
    expect(luminance(wash)).toBeGreaterThanOrEqual(0.66);
    expect(wash).not.toBe("#ffffff"); // the hue survives
  });

  it("sinks a pale colour into the jewel range by night", () => {
    const wash = washOf("#ffe79a", "dark");
    expect(luminance(wash)).toBeLessThanOrEqual(0.075);
    expect(wash).not.toBe("#000000");
  });

  it("leaves a colour already in range, and any reference, untouched", () => {
    expect(washOf("#ffe79a", "light")).toBe("#ffe79a");
    expect(washOf("#214233", "dark")).toBe("#214233");
    expect(washOf("var(--note-sun)", "dark")).toBe("var(--note-sun)");
  });
});

describe("inkOn", () => {
  it("picks the first of white, the board's ink and black to clear AA", () => {
    expect(inkOn("#0e6b66")).toBe("#ffffff");
    expect(inkOn("#ffe79a")).toBe("#20302f");
    // A mid-tone: white and the board's ink both fall short, black does not.
    expect(inkOn("#c47d2f")).toBe("#000000");
    for (const accent of ACCENTS)
      expect(contrast(inkOn(accent)!, accent), accent).toBeGreaterThanOrEqual(
        4.5,
      );
  });

  it("keeps the default ink for a theme-tuned reference", () => {
    expect(inkOn("var(--note-sun)")).toBeUndefined();
    expect(inkOn(undefined)).toBeUndefined();
  });
});
