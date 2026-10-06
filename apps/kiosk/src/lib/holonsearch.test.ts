// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The map's search box finds hubs to add. These specs pin what a query
// matches — a pasted id, a registered label, the registry — and the order
// the rows come out in.
import { describe, expect, it } from "vitest";
import { mergeHits, pastedHit, searchLabels } from "./holonsearch";

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
    const hits = mergeHits("l", registry, new Set(), 8, LABELS);
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
      new Set(["-5560750486"]),
      8,
      LABELS,
    );
    expect(hits.map((h) => [h.id, h.docked])).toEqual([["-5560750486", true]]);
  });

  it("caps the list", () => {
    expect(mergeHits("l", registry, new Set(), 2, LABELS)).toHaveLength(2);
  });
});
