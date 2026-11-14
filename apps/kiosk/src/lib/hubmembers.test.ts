// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it as spec, vi } from "vitest";

// The holon's join requests and genes, as a relay would stream them: each
// watcher keeps its callback here so the spec can say what arrives.
const feeds = vi.hoisted(() => ({
  requests: null as null | ((r: unknown[]) => void),
  genes: null as null | ((g: unknown[]) => void),
  stopped: 0,
}));
vi.mock("./holosphere", () => ({ getHolosphere: async () => ({}) }));
vi.mock("@holons/core/holons", async (orig) => ({
  ...(await orig<typeof import("@holons/core/holons")>()),
  watchJoinRequests: (
    _hs: unknown,
    _hub: string,
    cb: (r: unknown[]) => void,
  ) => {
    feeds.requests = cb;
    return () => void feeds.stopped++;
  },
}));
vi.mock("@holons/core/dna", async (orig) => ({
  ...(await orig<typeof import("@holons/core/dna")>()),
  subscribeGenes: (_hs: unknown, _hub: string, cb: (g: unknown[]) => void) => {
    feeds.genes = cb;
    return () => void feeds.stopped++;
  },
}));

import { dnaHash, normalizeGene } from "@holons/core/dna";
import { askedHere, parseDismissed, watchRequests } from "./hubmembers";

describe("dismissed join requests", () => {
  spec("parse keeps only hub|pubkey marks", () => {
    expect(parseDismissed(null).size).toBe(0);
    expect(parseDismissed("{")).toEqual(new Set());
    expect([
      ...parseDismissed(JSON.stringify(["holon_a|abc", 42, "nomark", "h|k"])),
    ]).toEqual(["holon_a|abc", "h|k"]);
  });
});

describe("join requests an admin sees", () => {
  spec("carry their readiness against the DNA as it is now", async () => {
    const gene = normalizeGene({
      id: "values",
      kind: "values",
      title: "Values",
      blurb: "What we hold to.",
      order: 0,
      ack: "agree",
      alleles: [{ id: "care", title: "Care" }],
      lang: "en",
      updated: "2026-11-01T00:00:00.000Z",
    })!;
    const hash = dnaHash([gene])!;
    const seen: Array<Array<{ pubkey: string; readiness: string }>> = [];
    const stop = watchRequests("-1003864542239", (r) => seen.push(r));
    await vi.waitFor(() => expect(feeds.requests && feeds.genes).toBeTruthy());

    const req = (pubkey: string, dna?: string) => ({
      pubkey,
      reason: "",
      at: 1,
      eventId: pubkey,
      ...(dna ? { dna } : {}),
    });
    feeds.requests!([
      req("a".repeat(64), hash),
      req("b".repeat(64), "f".repeat(64)),
      req("c".repeat(64)),
    ]);
    // Before the genes are read, nothing is guessed.
    expect(seen.at(-1)!.map((r) => r.readiness)).toEqual([
      "unknown",
      "unknown",
      "unknown",
    ]);

    feeds.genes!([gene]);
    expect(seen.at(-1)!.map((r) => r.readiness)).toEqual([
      "acknowledged",
      "outdated",
      "missing",
    ]);

    // A holon with nothing to agree to asks nothing.
    feeds.genes!([]);
    expect(seen.at(-1)!.map((r) => r.readiness)).toEqual([
      "none-required",
      "none-required",
      "none-required",
    ]);

    stop();
    expect(feeds.stopped).toBe(2);
  });

  spec("a screen nobody is logged into asked nothing", () => {
    expect(askedHere("-1003864542239")).toBe(false);
  });
});
