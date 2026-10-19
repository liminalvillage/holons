// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { CAPITALS, capitalColour, capitalName, capitalRows } from "./capitals";
import { en } from "./i18n/en";

describe("capitals", () => {
  it("are eight, financial last, each named in the catalog", () => {
    expect(CAPITALS).toHaveLength(8);
    expect(CAPITALS[7]).toBe("financial");
    for (const c of CAPITALS) {
      expect(en[capitalName(c)]).toBeTruthy();
      expect(capitalColour(c)).toBe(`var(--cap-${c})`);
    }
  });

  it("rows keep core's order and drop the empty", () => {
    expect(capitalRows({ financial: 1, living: 2, social: 0 })).toEqual([
      { capital: "living", n: 2 },
      { capital: "financial", n: 1 },
    ]);
    expect(capitalRows(null)).toEqual([]);
  });
});
