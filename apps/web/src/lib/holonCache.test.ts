// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { afterEach, describe, expect, it } from "vitest";
import { clearHolonCache, getCachedPurpose, preloadHolon } from "./holonCache";

const gene = (fields: Record<string, unknown>) => ({
  id: "g",
  kind: "values",
  title: "G",
  blurb: "",
  order: 0,
  ack: "none",
  alleles: [],
  lang: "en",
  updated: "",
  ...fields,
});

function fakeHs(genes: unknown[], settings: Record<string, unknown>) {
  return {
    get: async () => settings,
    getAll: async (_h: string, lens: string) => (lens === "genes" ? genes : []),
    subscribe: () => ({ unsubscribe() {} }),
  };
}

afterEach(() => clearHolonCache("grove"));

describe("holonCache purpose", () => {
  it("is the DNA's purpose gene, not settings.purpose", async () => {
    const hs = fakeHs(
      [
        gene({
          id: "purpose",
          kind: "purpose",
          title: "Purpose",
          blurb: "Tend the grove.",
        }),
      ],
      { id: "grove", name: "Grove", purpose: "the old field" },
    );
    await preloadHolon(hs, "grove", { force: true });
    expect(getCachedPurpose("grove")).toBe("Tend the grove.");
  });

  it("is empty when the holon has no purpose gene, and for a holon never read", async () => {
    const hs = fakeHs([], {
      id: "grove",
      name: "Grove",
      purpose: "the old field",
    });
    await preloadHolon(hs, "grove", { force: true });
    expect(getCachedPurpose("grove")).toBe("");
    expect(getCachedPurpose("never-read")).toBe("");
  });
});
