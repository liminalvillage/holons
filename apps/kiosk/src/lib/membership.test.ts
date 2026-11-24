// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
const puts: { holon: string; lens: string; data: any }[] = [];
let standing: "accepted" | "held" | "open" = "accepted";
let pubkey = "aa";
let acceptanceCalls = 0;
let acceptanceFails = false;

vi.mock("./holosphere", () => ({
  getHolosphere: vi.fn(async () => ({
    currentPubkey: pubkey,
    get: async (holon: string, lens: string, key: string) =>
      store.get(`${holon}/${lens}/${key}`) ?? null,
  })),
  getWriter: vi.fn(async (holon: string) => ({
    put: async (lens: string, data: any) => {
      puts.push({ holon, lens, data });
      return true;
    },
    canWrite: async () => true,
  })),
}));

vi.mock("@holons/core/holosphere", async (orig) => ({
  ...(await orig<typeof import("@holons/core/holosphere")>()),
  writeAcceptance: vi.fn(async () => {
    acceptanceCalls += 1;
    if (acceptanceFails) throw new Error("offline");
    return {
      status: standing,
      role: null,
      anchor: null,
      source: null,
    };
  }),
}));

import { acceptedIn, forgetStanding, joinOnly, toggleJoin } from "./membership";

beforeEach(() => {
  store.clear();
  puts.length = 0;
  standing = "accepted";
  pubkey = "aa";
  acceptanceCalls = 0;
  acceptanceFails = false;
  forgetStanding();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}")),
  );
});

describe("toggleJoin (#316 stopgap)", () => {
  const user = { id: 42, first_name: "Ada" };

  it("refuses to take a held key off a source holon's card", async () => {
    store.set("P/quests/q1", { id: "q1", participants: [{ id: 42 }] });
    standing = "held";
    expect(await toggleJoin("H", "q1", user, { holon: "P", key: "q1" })).toBe(
      "held-leave",
    );
    expect(puts).toHaveLength(0);
  });

  it("leaves normally when the key is accepted", async () => {
    store.set("P/quests/q1", { id: "q1", participants: [{ id: 42 }] });
    expect(await toggleJoin("H", "q1", user, { holon: "P", key: "q1" })).toBe(
      true,
    );
    expect(puts[0].holon).toBe("P");
    expect(puts[0].data.participants ?? []).toHaveLength(0);
  });

  it("refuses a held key's join too — it could never be undone", async () => {
    store.set("P/quests/q1", { id: "q1", participants: [] });
    standing = "held";
    expect(await toggleJoin("H", "q1", user, { holon: "P", key: "q1" })).toBe(
      "held-join",
    );
    expect(await joinOnly("H", "q1", user, { holon: "P", key: "q1" })).toBe(
      "held",
    );
    expect(puts).toHaveLength(0);
  });

  it("joins normally when the key is accepted", async () => {
    store.set("P/quests/q1", { id: "q1", participants: [] });
    expect(await toggleJoin("H", "q1", user, { holon: "P", key: "q1" })).toBe(
      true,
    );
    expect(puts).toHaveLength(1);
  });
});

describe("acceptedIn cache", () => {
  it("is keyed by signer: the next person on a shared kiosk asks afresh", async () => {
    standing = "held";
    expect(await acceptedIn("P")).toBe(false);
    pubkey = "bb";
    standing = "accepted";
    expect(await acceptedIn("P")).toBe(true);
    expect(acceptanceCalls).toBe(2);
    // Same signer and holon within the TTL: answered from the cache.
    expect(await acceptedIn("P")).toBe(true);
    expect(acceptanceCalls).toBe(2);
  });

  it("does not keep an offline/error answer", async () => {
    acceptanceFails = true;
    expect(await acceptedIn("P")).toBe(true); // unknown → let the write decide
    acceptanceFails = false;
    standing = "held";
    expect(await acceptedIn("P")).toBe(false);
    expect(acceptanceCalls).toBe(2);
  });
});
