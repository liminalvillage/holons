// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  generatePkce,
  generateState,
  buildAuthorizationUrl,
  deriveNostrKey,
  mintSession,
  verifySession,
  mintKeySession,
  verifySessionIdentity,
} from "./telegramAuth";

const JWT_SECRET = "a".repeat(48);
const DERIVATION_SECRET = "derivation-secret-for-tests";

describe("PKCE", () => {
  it("derives the S256 challenge from the verifier", () => {
    const { verifier, challenge } = generatePkce();
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
    expect(verifier.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
  });

  it("produces a fresh verifier each call", () => {
    expect(generatePkce().verifier).not.toBe(generatePkce().verifier);
    expect(generateState()).not.toBe(generateState());
  });
});

describe("buildAuthorizationUrl", () => {
  it("targets oauth.telegram.org with the required OIDC params", () => {
    const url = new URL(
      buildAuthorizationUrl({
        clientId: "6152474485",
        redirectUri: "https://app.example.com/api/auth/telegram/callback",
        state: "st4te",
        codeChallenge: "chall",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://oauth.telegram.org/auth");
    expect(url.searchParams.get("client_id")).toBe("6152474485");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/auth/telegram/callback",
    );
    expect(url.searchParams.get("scope")).toContain("openid");
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("code_challenge")).toBe("chall");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("deriveNostrKey", () => {
  it("is deterministic for the same Telegram id", () => {
    const a = deriveNostrKey("235114395", DERIVATION_SECRET);
    const b = deriveNostrKey(235114395, DERIVATION_SECRET);
    expect(a.privateKey).toBe(b.privateKey);
    expect(a.publicKey).toBe(b.publicKey);
    expect(a.privateKey).toHaveLength(64);
    expect(a.publicKey).toHaveLength(64);
  });

  it("produces different keys for different users", () => {
    expect(deriveNostrKey("1", DERIVATION_SECRET).publicKey).not.toBe(
      deriveNostrKey("2", DERIVATION_SECRET).publicKey,
    );
  });
});

describe("mintSession / verifySession", () => {
  it("round-trips the profile through a signed JWT", async () => {
    const token = await mintSession(
      { id: "42", first_name: "Ann", username: "ann" },
      JWT_SECRET,
    );
    const profile = await verifySession(token, JWT_SECRET);
    expect(profile).not.toBeNull();
    expect(profile!.id).toBe("42");
    expect(profile!.username).toBe("ann");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await mintSession(
      { id: "42", first_name: "Ann" },
      JWT_SECRET,
    );
    expect(
      await verifySession(token, "different-secret-aaaaaaaaaaaaaaaa"),
    ).toBeNull();
  });

  it("rejects a garbage token", async () => {
    expect(await verifySession("not.a.jwt", JWT_SECRET)).toBeNull();
    expect(await verifySession(undefined, JWT_SECRET)).toBeNull();
  });
});

describe("key sessions", () => {
  const pubkey = "ab".repeat(32);

  it("round-trips a key identity and never surfaces it as a Telegram profile", async () => {
    const token = await mintKeySession(
      { pubkey, provider: "passkey" },
      JWT_SECRET,
    );
    expect(await verifySessionIdentity(token, JWT_SECRET)).toEqual({
      kind: "key",
      pubkey,
      provider: "passkey",
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
  });

  it("refuses to mint for a malformed pubkey", async () => {
    await expect(
      mintKeySession({ pubkey: "nope", provider: "nostr" }, JWT_SECRET),
    ).rejects.toThrow();
  });
});
