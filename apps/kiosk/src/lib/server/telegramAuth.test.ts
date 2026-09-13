// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, it, expect } from "vitest";
import {
  mintSession,
  verifySession,
  mintKeySession,
  verifySessionIdentity,
  returnDestination,
} from "./telegramAuth";

const JWT_SECRET = "a".repeat(48);

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
