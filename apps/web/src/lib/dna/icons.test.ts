// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { ALLELE_ICON_CLASS, ICON_KEYS, iconClass } from "./icons";

describe("allele icons", () => {
  it("draws every key core knows, with a Font Awesome class and nothing else", () => {
    for (const key of ICON_KEYS)
      expect(ALLELE_ICON_CLASS[key], key).toMatch(/^fa-[a-z-]+$/);
    expect(Object.keys(ALLELE_ICON_CLASS).sort()).toEqual(
      [...ICON_KEYS].sort(),
    );
  });

  it("names only glyphs the bundled Font Awesome has", () => {
    const css = readFileSync(
      createRequire(import.meta.url).resolve(
        "@fortawesome/fontawesome-free/css/all.min.css",
      ),
      "utf8",
    );
    for (const [key, cls] of Object.entries(ALLELE_ICON_CLASS))
      expect(css.includes(`.${cls}`), `${key} → ${cls}`).toBe(true);
  });

  it("gives nothing for no icon or an unknown key", () => {
    expect(iconClass(undefined)).toBe("");
    expect(iconClass("")).toBe("");
    expect(iconClass("😀")).toBe("");
    expect(iconClass("leaf")).toBe("fa-solid fa-leaf");
  });
});
