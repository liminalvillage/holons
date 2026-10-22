// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The hub half of the map's search box. These specs pin what a query
// matches — a pasted id, a hub on the dock, a registered label, the registry
// — and the order the rows come out in.
import { describe, expect, it } from "vitest";
import {
  mergeHits,
  pastedHit,
  searchDocked,
  searchLabels,
} from "./holonsearch";

const LABELS = {
  liminal: "-1003864542239",
  lunation: "-1004318065568",
  moon: "-1004318065568",
};

describe("searchLabels", () => {
  it("matches a label by substring, case-insensitively, in label order", () => {
    expect(searchLabels("L", LABELS).map((h) => h.id)).toEqual([
      "-1003864542239",
      "-1004318065568",
    ]);
    expect(searchLabels("mina", LABELS).map((h) => h.id)).toEqual([
      "-1003864542239",
    ]);
  });

  it("names the hit by its label, once per hub, and matches an exact id", () => {
    expect(searchLabels("-1004318065568", LABELS)).toEqual([
      { id: "-1004318065568", name: "Lunation", type: "community" },
    ]);
  });

  it("is empty for a blank query", () => {
    expect(searchLabels("   ", LABELS)).toEqual([]);
  });
});

describe("searchDocked", () => {
  const DOCK = [
    { id: "holon_fig33pftaepw96i4", name: "Liminal grove" },
    { id: "-5560750486", name: "Oilonics" },
    { id: "-5468909450", name: "Collector's guild" },
  ];

  it("finds a docked hub by its name, in name order", () => {
    expect(searchDocked("IL", DOCK).map((h) => h.name)).toEqual([
      "Collector's guild",
      "Oilonics",
    ]);
  });

  it("matches an id typed whole, never a fragment of one", () => {
    expect(searchDocked("-5560750486", DOCK).map((h) => h.id)).toEqual([
      "-5560750486",
    ]);
    expect(searchDocked("5560", DOCK)).toEqual([]);
  });

  it("is empty for a blank query", () => {
    expect(searchDocked("  ", DOCK)).toEqual([]);
  });
});

describe("pastedHit", () => {
  it("takes a group id or a link whole", () => {
    expect(pastedHit("-1001652773351")?.id).toBe("-1001652773351");
    expect(pastedHit("https://hubs.network/-1001652773351")?.id).toBe(
      "-1001652773351",
    );
  });

  it("is null for a bare word", () => {
    expect(pastedHit("garden")).toBeNull();
  });
});

describe("mergeHits", () => {
  const registry = [
    { id: "-1003864542239", name: "Holon -1003864542239", type: "community" },
    { id: "-5560750486", name: "Oilonics", type: "community" },
  ];

  it("puts the label's hit before the registry's and dedupes by id", () => {
    const hits = mergeHits("l", registry, [], 8, LABELS);
    expect(hits.map((h) => h.id)).toEqual([
      "-1003864542239",
      "-1004318065568",
      "-5560750486",
    ]);
    // The label's name wins over the registry's placeholder for the same hub.
    expect(hits[0].name).toBe("Liminal");
  });

  it("leads with a pasted id and marks what is docked already", () => {
    // The registry's own search already narrowed its rows to the query.
    const hits = mergeHits(
      "-5560750486",
      registry.filter((h) => h.id === "-5560750486"),
      [{ id: "-5560750486", name: "Oilonics" }],
      8,
      LABELS,
    );
    expect(hits.map((h) => [h.id, h.docked])).toEqual([["-5560750486", true]]);
  });

  it("finds a hub only the dock knows, ahead of every index", () => {
    const hits = mergeHits(
      "grove",
      [{ id: "-777", name: "Olive grove", type: "community" }],
      [{ id: "holon_fig33pftaepw96i4", name: "Liminal grove" }],
      8,
      LABELS,
    );
    expect(hits.map((h) => [h.name, h.docked])).toEqual([
      ["Liminal grove", true],
      ["Olive grove", false],
    ]);
  });

  it("keeps the name the query matched for a hub docked under another", () => {
    // The label matches the query; the dock's own name for the hub does not.
    const hits = mergeHits(
      "limin",
      [],
      [{ id: "-1003864542239", name: "Chaordination" }],
      8,
      LABELS,
    );
    expect(hits).toEqual([
      {
        id: "-1003864542239",
        name: "Liminal",
        type: "community",
        docked: true,
      },
    ]);
  });

  it("caps the list", () => {
    expect(mergeHits("l", registry, [], 2, LABELS)).toHaveLength(2);
  });
});
