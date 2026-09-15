// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The screen's side of the start-a-hub loop: what it remembers while the
// person is away in Telegram, the deep links it sends them out with, and how
// it notices the bot redeeming the token.

import { describe, it as spec, expect, vi } from "vitest";
import { CLAIM_MAX_AGE_MS } from "@holons/core/onboarding";
import { hubClaimUrls, parsePendingClaim, watchHubClaim } from "./hubclaim";

const TOKEN = "ABCDEFGHIJKLMNOPQRSTUV";
const T0 = 1_760_000_000_000;

describe("parsePendingClaim", () => {
  spec("reads back a fresh note", () => {
    expect(
      parsePendingClaim(JSON.stringify({ token: TOKEN, at: T0 }), T0 + 1000),
    ).toEqual({ token: TOKEN, at: T0 });
  });

  spec("forgets a note that is stale, malformed, or from the future", () => {
    expect(
      parsePendingClaim(
        JSON.stringify({ token: TOKEN, at: T0 }),
        T0 + CLAIM_MAX_AGE_MS + 1,
      ),
    ).toBeNull();
    expect(
      parsePendingClaim(JSON.stringify({ token: TOKEN, at: T0 + 120_000 }), T0),
    ).toBeNull();
    expect(
      parsePendingClaim(JSON.stringify({ token: "nope", at: T0 })),
    ).toBeNull();
    expect(parsePendingClaim(JSON.stringify({ token: TOKEN }))).toBeNull();
    expect(parsePendingClaim("{not json")).toBeNull();
    expect(parsePendingClaim(null)).toBeNull();
  });
});

describe("hubClaimUrls", () => {
  spec("puts the token in both deep links", () => {
    const urls = hubClaimUrls(TOKEN);
    expect(urls.personal).toMatch(
      /^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=claim_ABCDEFGHIJKLMNOPQRSTUV$/,
    );
    expect(urls.group).toMatch(
      /^https:\/\/t\.me\/[A-Za-z0-9_]+\?startgroup=claim_ABCDEFGHIJKLMNOPQRSTUV$/,
    );
  });
});

describe("watchHubClaim", () => {
  const claim = {
    id: TOKEN,
    holon: "-1001234567890",
    kind: "group",
    at: Date.now(),
  };

  function fakeHolosphere(initial: unknown = null) {
    let cb: ((data: unknown, key?: string) => void) | null = null;
    const unsubscribe = vi.fn(() => (cb = null));
    return {
      hs: {
        get: vi.fn(async () => initial),
        subscribe: vi.fn((_h: string, _l: string, fn: typeof cb) => {
          cb = fn;
          return { unsubscribe };
        }),
      } as any,
      emit: (data: unknown) => cb?.(data, (data as any)?.id),
      unsubscribe,
    };
  }

  spec(
    "fires once when the subscription carries the claim, then stops",
    async () => {
      const { hs, emit, unsubscribe } = fakeHolosphere();
      const onClaim = vi.fn();
      watchHubClaim(hs, TOKEN, onClaim, { pollMs: 60_000 });
      await Promise.resolve();
      await Promise.resolve();
      emit({ ...claim, id: "ABCDEFGHIJKLMNOPQRSTUW" }); // someone else's token
      expect(onClaim).not.toHaveBeenCalled();
      emit(claim);
      emit(claim);
      expect(onClaim).toHaveBeenCalledTimes(1);
      expect(onClaim).toHaveBeenCalledWith(claim);
      expect(unsubscribe).toHaveBeenCalled();
    },
  );

  spec("finds a claim already on the relay by the first read", async () => {
    const { hs } = fakeHolosphere(claim);
    const onClaim = vi.fn();
    watchHubClaim(hs, TOKEN, onClaim, { pollMs: 60_000 });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(onClaim).toHaveBeenCalledWith(claim);
  });

  spec("stopping first means nothing fires", async () => {
    const { hs, emit } = fakeHolosphere(claim);
    const onClaim = vi.fn();
    const stop = watchHubClaim(hs, TOKEN, onClaim, { pollMs: 60_000 });
    stop();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    emit(claim);
    expect(onClaim).not.toHaveBeenCalled();
  });
});
