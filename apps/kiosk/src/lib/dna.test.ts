// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { ALLELE_ICONS, GENE_LIMITS } from "@holons/core/dna";
import {
  ALLELE_ICON_NAME,
  alleleIconName,
  iconWords,
  kb,
  meterLevel,
  starterLang,
} from "./dna";
import { isIconName } from "./icons";
import { en } from "./i18n/en";
import { KIND_LABEL, ISSUE_LABEL } from "./dna";

describe("DNA icons", () => {
  it("draws every semantic key core knows, and only those, from the catalog", () => {
    expect(Object.keys(ALLELE_ICON_NAME).sort()).toEqual(
      [...ALLELE_ICONS].sort(),
    );
    for (const key of ALLELE_ICONS)
      expect(isIconName(alleleIconName(key)), key).toBe(true);
  });

  it("reads a key as words", () => {
    expect(iconWords("person-check")).toBe("person check");
  });
});

describe("DNA words", () => {
  it("has a message for every kind and every issue code", () => {
    for (const key of [
      ...Object.values(KIND_LABEL),
      ...Object.values(ISSUE_LABEL),
    ])
      expect(en, key).toHaveProperty([key]);
  });

  it("falls back to English for a language without starter genes", () => {
    expect(starterLang("it")).toBe("it");
    expect(starterLang("es")).toBe("en");
  });
});

describe("size meter", () => {
  it("is red over the cap, a warning from 80%, fine below", () => {
    expect(meterLevel(1000)).toBe("ok");
    expect(meterLevel(GENE_LIMITS.bytes * 0.8)).toBe("warn");
    expect(meterLevel(GENE_LIMITS.bytes)).toBe("warn");
    expect(meterLevel(GENE_LIMITS.bytes + 1)).toBe("over");
    expect(kb(1536)).toBe("1.5");
    expect(kb(48 * 1024)).toBe("48");
  });
});
