// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from "vitest";
import type { HoloSphere } from "holosphere";
import { readPurpose } from "./purpose";

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

const hsWith = (rows: unknown[]) =>
  ({
    getAll: async (_h: string, lens: string) => (lens === "genes" ? rows : []),
  }) as unknown as HoloSphere;

describe("readPurpose", () => {
  it("is the purpose gene's blurb", async () => {
    const hs = hsWith([
      gene({ id: "values", kind: "values", blurb: "not this" }),
      gene({
        id: "purpose",
        kind: "purpose",
        title: "Purpose",
        blurb: "  A living lab.  ",
      }),
    ]);
    expect(await readPurpose(hs, "h")).toBe("A living lab.");
  });

  it("is empty without a purpose gene, without a holosphere, or when the genes cannot be read", async () => {
    expect(await readPurpose(hsWith([gene({ id: "values" })]), "h")).toBe("");
    expect(await readPurpose(hsWith([]), "h")).toBe("");
    expect(await readPurpose(null, "h")).toBe("");
    const broken = {
      getAll: async () => {
        throw new Error("relay down");
      },
    } as unknown as HoloSphere;
    expect(await readPurpose(broken, "h")).toBe("");
  });

  it("never reads settings.purpose any more", async () => {
    const hs = {
      getAll: async (_h: string, lens: string) =>
        lens === "settings" ? [{ id: "h", purpose: "old" }] : [],
    } as unknown as HoloSphere;
    expect(await readPurpose(hs, "h")).toBe("");
  });
});
