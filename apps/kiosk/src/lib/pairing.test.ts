// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from "vitest";
import {
  buildDeepLink,
  buildStartParam,
  generateEphemeral,
  newChannelId,
  openKey,
  parseStartParam,
  sealKey,
} from "./pairing";

const SECRET = "a".repeat(64); // any 32-byte hex

describe("seal/open roundtrip", () => {
  it("delivers the secret sealed to the kiosk ephemeral", async () => {
    const kiosk = generateEphemeral();
    const env = await sealKey(
      SECRET,
      kiosk.pubHex,
      newChannelId(),
      "235114395",
    );
    expect(env.telegramId).toBe("235114395");
    expect(await openKey(kiosk.privHex, env)).toBe(SECRET);
  });

  it("a different kiosk key cannot open the envelope", async () => {
    const kiosk = generateEphemeral();
    const env = await sealKey(SECRET, kiosk.pubHex, newChannelId());
    expect(await openKey(generateEphemeral().privHex, env)).toBeNull();
  });

  it("tampered ciphertext fails authentication", async () => {
    const kiosk = generateEphemeral();
    const env = await sealKey(SECRET, kiosk.pubHex, newChannelId());
    const flipped = (parseInt(env.ct[0], 16) ^ 1).toString(16);
    expect(
      await openKey(kiosk.privHex, { ...env, ct: flipped + env.ct.slice(1) }),
    ).toBeNull();
  });

  it("stale envelopes are rejected", async () => {
    const kiosk = generateEphemeral();
    const env = await sealKey(SECRET, kiosk.pubHex, newChannelId());
    const stale = {
      ...env,
      created: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    };
    expect(await openKey(kiosk.privHex, stale)).toBeNull();
  });

  it("two pairings never share a sender ephemeral", async () => {
    const kiosk = generateEphemeral();
    const a = await sealKey(SECRET, kiosk.pubHex, newChannelId());
    const b = await sealKey(SECRET, kiosk.pubHex, newChannelId());
    expect(a.senderPub).not.toBe(b.senderPub);
    expect(a.ct).not.toBe(b.ct);
  });
});

describe("start param", () => {
  it("roundtrips and stays within Telegram's charset", () => {
    const kiosk = generateEphemeral();
    const ch = newChannelId();
    const param = buildStartParam(ch, kiosk.pubHex);
    expect(param).toMatch(/^[A-Za-z0-9_-]{1,512}$/);
    expect(parseStartParam(param)).toEqual({
      channelId: ch,
      kioskPub: kiosk.pubHex,
    });
  });

  it("rejects malformed payloads", () => {
    expect(parseStartParam(undefined)).toBeNull();
    expect(parseStartParam("")).toBeNull();
    expect(parseStartParam("v1-short-deadbeef")).toBeNull();
    expect(
      parseStartParam("v2-" + "0".repeat(32) + "-" + "0".repeat(66)),
    ).toBeNull();
  });

  it("builds the t.me deep link", () => {
    expect(buildDeepLink("HolonsBot/keys", "v1-x-y")).toBe(
      "https://t.me/HolonsBot/keys?startapp=v1-x-y",
    );
  });
});
