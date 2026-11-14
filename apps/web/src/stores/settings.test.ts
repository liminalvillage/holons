// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { settingsHelpers, settingsStore } from "./settings";

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

function fakeHs(rows: { settings?: unknown[]; genes?: unknown[] }) {
  const puts: Array<{
    holon: string;
    lens: string;
    data: Record<string, unknown>;
  }> = [];
  const hs = {
    getAll: async (_h: string, lens: string) =>
      lens === "settings"
        ? (rows.settings ?? [])
        : lens === "genes"
          ? (rows.genes ?? [])
          : [],
    put: async (holon: string, lens: string, data: Record<string, unknown>) =>
      void puts.push({ holon, lens, data }),
  };
  return { hs, puts };
}

describe("settings store", () => {
  it("reads the purpose from the DNA's purpose gene, whatever settings.purpose says", async () => {
    const { hs } = fakeHs({
      settings: [{ id: "h", name: "Grove", purpose: "the old field" }],
      genes: [
        gene({
          id: "purpose",
          kind: "purpose",
          title: "Purpose",
          blurb: "Tend the grove.",
        }),
      ],
    });
    await settingsHelpers.loadSettings(hs, "h");
    expect(get(settingsStore).purpose).toBe("Tend the grove.");
    expect(get(settingsStore).name).toBe("Grove");
  });

  it("has no purpose when the DNA has none, even if settings.purpose is set", async () => {
    const { hs } = fakeHs({
      settings: [{ id: "h", name: "Grove", purpose: "the old field" }],
      genes: [],
    });
    await settingsHelpers.loadSettings(hs, "h");
    expect(get(settingsStore).purpose).toBe("");
  });

  it("never writes the purpose back into the settings", async () => {
    const { hs, puts } = fakeHs({
      settings: [{ id: "h", name: "Grove" }],
      genes: [
        gene({
          id: "purpose",
          kind: "purpose",
          title: "Purpose",
          blurb: "Tend the grove.",
        }),
      ],
    });
    await settingsHelpers.loadSettings(hs, "h");
    await settingsHelpers.saveSettings(hs, "h");
    expect(puts).toHaveLength(1);
    expect(puts[0].lens).toBe("settings");
    expect(puts[0].data).not.toHaveProperty("purpose");
    expect(puts[0].data.name).toBe("Grove");
  });
});
