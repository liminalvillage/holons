// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, it, expect } from "vitest";
import {
  derivedKeyFor,
  mintSession,
  verifySession,
  mintKeySession,
  verifySessionIdentity,
  returnDestination,
  verifyInitData,
  INIT_DATA_MAX_AGE_S,
} from "./telegramAuth";
import { createHmac } from "node:crypto";

const JWT_SECRET = "a".repeat(48);

describe("derivedKeyFor", () => {
  it("is the bot's key for the Telegram id, and null without the secret", async () => {
    const { deriveTelegramNostrKey } = await import("@holons/core/auth");
    const got = derivedKeyFor({ id: "235114395" }, "s3cret");
    expect(got?.nostrPublicKey).toBe(
      deriveTelegramNostrKey("235114395", "s3cret").publicKey,
    );
    expect(got?.nostrPrivateKey).toMatch(/^[0-9a-f]{64}$/);
    expect(derivedKeyFor({ id: "235114395" }, "")).toBeNull();
  });
});

describe("key sessions", () => {
  const pubkey = "ab".repeat(32);

  it("round-trips a key identity and never surfaces it as a Telegram profile", async () => {
    const token = await mintKeySession(
      { pubkey, provider: "ethereum" },
      JWT_SECRET,
    );
    expect(await verifySessionIdentity(token, JWT_SECRET)).toEqual({
      kind: "key",
      pubkey,
      provider: "ethereum",
    });
    expect(await verifySession(token, JWT_SECRET)).toBeNull();
  });

  it("classifies a Telegram session as telegram", async () => {
    const token = await mintSession(
      { id: "42", first_name: "Ann" },
      JWT_SECRET,
    );
    const id = await verifySessionIdentity(token, JWT_SECRET);
    expect(id?.kind).toBe("telegram");
    expect(id?.kind === "telegram" && id.profile.id).toBe("42");
    expect((await verifySession(token, JWT_SECRET))?.id).toBe("42");
  });

  it("refuses to mint for a malformed pubkey", async () => {
    await expect(
      mintKeySession({ pubkey: "nope", provider: "nostr" }, JWT_SECRET),
    ).rejects.toThrow();
  });

  it("rejects a tampered or foreign token", async () => {
    const token = await mintKeySession(
      { pubkey, provider: "nostr" },
      JWT_SECRET,
    );
    expect(await verifySessionIdentity(token, "b".repeat(48))).toBeNull();
    expect(await verifySessionIdentity("not.a.jwt", JWT_SECRET)).toBeNull();
  });
});

describe("returnDestination", () => {
  it("keeps the path and query of a hubs.network deep link", () => {
    expect(
      returnDestination("https://liminal.hubs.network/liminal/tasks?task=t1"),
    ).toBe("https://liminal.hubs.network/liminal/tasks?task=t1");
  });
  it("normalises a bare origin to its root", () => {
    expect(returnDestination("https://hubs.network")).toBe(
      "https://hubs.network/",
    );
  });
  it("allows localhost in dev", () => {
    expect(returnDestination("http://localhost:5173/x?event=e")).toBe(
      "http://localhost:5173/x?event=e",
    );
  });
  it("falls back to the root for a foreign origin, garbage, or nothing", () => {
    expect(returnDestination("https://evil.example/liminal")).toBe("/");
    expect(returnDestination("http://hubs.network/")).toBe("/");
    expect(returnDestination("not a url")).toBe("/");
    expect(returnDestination(undefined)).toBe("/");
  });
});

describe("verifyInitData", () => {
  const TOKEN = "123456:test-bot-token";
  const NOW = 1_800_000_000_000;

  /** initData exactly as Telegram signs it for a bot token. */
  function sign(fields: Record<string, string>, token = TOKEN): string {
    const check = Object.entries(fields)
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join("\n");
    const secret = createHmac("sha256", "WebAppData").update(token).digest();
    const hash = createHmac("sha256", secret).update(check).digest("hex");
    return new URLSearchParams({ ...fields, hash }).toString();
  }
  const launch = (over: Record<string, string> = {}) => ({
    auth_date: String(NOW / 1000 - 60),
    user: JSON.stringify({
      id: 235114395,
      first_name: "Roberto",
      username: "rv",
    }),
    start_param: "-1001234567890",
    ...over,
  });

  it("returns the launching user and the start param", () => {
    expect(verifyInitData(sign(launch()), [TOKEN], NOW)).toEqual({
      profile: {
        id: "235114395",
        first_name: "Roberto",
        last_name: undefined,
        username: "rv",
        photo_url: undefined,
      },
      startParam: "-1001234567890",
    });
  });

  it("accepts whichever configured bot signed it", () => {
    const data = sign(launch(), "999:other-bot");
    expect(
      verifyInitData(data, [TOKEN, "999:other-bot"], NOW)?.profile.id,
    ).toBe("235114395");
    expect(verifyInitData(data, [TOKEN], NOW)).toBeNull();
  });

  it("rejects tampering, staleness and launches without a user", () => {
    const tampered = sign(launch()).replace("Roberto", "Mallory");
    expect(verifyInitData(tampered, [TOKEN], NOW)).toBeNull();
    const stale = launch({
      auth_date: String(NOW / 1000 - INIT_DATA_MAX_AGE_S - 1),
    });
    expect(verifyInitData(sign(stale), [TOKEN], NOW)).toBeNull();
    const { user: _user, ...anonymous } = launch();
    expect(verifyInitData(sign(anonymous), [TOKEN], NOW)).toBeNull();
    expect(verifyInitData("", [TOKEN], NOW)).toBeNull();
    expect(verifyInitData(sign(launch()), [], NOW)).toBeNull();
  });
});
