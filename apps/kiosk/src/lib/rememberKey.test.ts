// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it as spec } from "vitest";
import {
  REMEMBER_KEY,
  forgetRememberedKey,
  parseRememberedKey,
  readRememberedKey,
  rememberKey,
  unlockRememberedKey,
} from "./rememberKey";

const SK = "1f".repeat(32);
const PK = "ab".repeat(32);

// A localStorage for the spec: the module reads the global, so give it one.
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

describe("a remembered key", () => {
  beforeEach(() => mem.clear());

  spec(
    "seals under a PIN, opens only with it, and is forgotten on demand",
    () => {
      const rec = rememberKey(
        SK,
        "2468",
        { pubkey: PK.toUpperCase(), provider: "nostr", label: "npub1…" },
        { logn: 8, now: 5 },
      );
      expect(rec).toMatchObject({
        pubkey: PK,
        provider: "nostr",
        label: "npub1…",
        at: 5,
      });
      expect(rec.ncryptsec.startsWith("ncryptsec1")).toBe(true);
      expect(mem.get(REMEMBER_KEY)).toContain("ncryptsec1");
      expect(mem.get(REMEMBER_KEY)).not.toContain(SK);
      expect(readRememberedKey()).toEqual(rec);
      expect(unlockRememberedKey("2468")).toBe(SK);
      expect(unlockRememberedKey("0000")).toBeNull();
      forgetRememberedKey();
      expect(readRememberedKey()).toBeNull();
      expect(unlockRememberedKey("2468")).toBeNull();
    },
  );

  spec("a malformed note is dropped rather than trusted", () => {
    expect(parseRememberedKey(null)).toBeNull();
    expect(parseRememberedKey("{")).toBeNull();
    expect(
      parseRememberedKey(
        JSON.stringify({
          ncryptsec: "nsec1x",
          pubkey: PK,
          provider: "nostr",
          at: 1,
        }),
      ),
    ).toBeNull();
    expect(
      parseRememberedKey(
        JSON.stringify({
          ncryptsec: "ncryptsec1x",
          pubkey: "short",
          provider: "nostr",
          at: 1,
        }),
      ),
    ).toBeNull();
    expect(
      parseRememberedKey(
        JSON.stringify({
          ncryptsec: "ncryptsec1x",
          pubkey: PK,
          provider: "telegram",
          at: 1,
        }),
      ),
    ).toBeNull();
    expect(
      parseRememberedKey(
        JSON.stringify({
          ncryptsec: "ncryptsec1x",
          pubkey: PK,
          provider: "ethereum",
          at: "x",
        }),
      ),
    ).toBeNull();
    mem.set(REMEMBER_KEY, "garbage");
    expect(readRememberedKey()).toBeNull();
    expect(mem.has(REMEMBER_KEY)).toBe(false); // cleaned up
  });
});
