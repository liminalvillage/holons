// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The screen's side of linking a Telegram chat: what it remembers while the
// person is away, the deep links, and how it believes the bot's answer.

import { describe, it as spec, expect, vi } from "vitest";
import {
  LINK_MAX_AGE_MS,
  linkId,
  parseLinkPayload,
} from "@holons/core/linking";
import {
  parsePendingLink,
  telegramLinkUrls,
  watchTelegramLink,
} from "./tglink";

const HUB = "holon_k7m3p9q2r5t8v1w4";
const TOKEN = "ABCDEFGHIJKLMNOPQRSTUV";
const ID = linkId(TOKEN);
const T0 = 1_760_000_000_000;
const note = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ hub: HUB, token: TOKEN, id: ID, at: T0, ...over });

describe("parsePendingLink", () => {
  spec("reads back a fresh note, for the hub asked about", () => {
    expect(parsePendingLink(note(), T0 + 1000)).toEqual({
      hub: HUB,
      token: TOKEN,
      id: ID,
      at: T0,
    });
    expect(parsePendingLink(note(), T0 + 1000, HUB)).not.toBeNull();
    expect(
      parsePendingLink(note(), T0 + 1000, "holon_other000000000"),
    ).toBeNull();
  });
  spec(
    "forgets a note that is stale, malformed, or not a founded holon's",
    () => {
      expect(parsePendingLink(note(), T0 + LINK_MAX_AGE_MS + 1)).toBeNull();
      expect(parsePendingLink(note({ at: T0 + 120_000 }), T0)).toBeNull();
      expect(parsePendingLink(note({ hub: "-1001234567890" }), T0)).toBeNull();
      expect(parsePendingLink(note({ token: "nope" }), T0)).toBeNull();
      expect(parsePendingLink(note({ id: "zz" }), T0)).toBeNull();
      expect(parsePendingLink("{", T0)).toBeNull();
      expect(parsePendingLink(null, T0)).toBeNull();
    },
  );
});

describe("telegramLinkUrls", () => {
  spec(
    "carries the same payload out both ways, short enough for Telegram",
    () => {
      const { personal, group } = telegramLinkUrls(HUB, TOKEN);
      const payload = new URL(personal).searchParams.get("start")!;
      expect(new URL(group).searchParams.get("startgroup")).toBe(payload);
      expect(payload.length).toBeLessThanOrEqual(64);
      expect(parseLinkPayload(payload)).toEqual({ holon: HUB, token: TOKEN });
    },
  );
});

describe("watchTelegramLink", () => {
  const CHAT = "-1001234567890";
  function fakeHs() {
    const subs: Array<(d: unknown) => void> = [];
    const hs = {
      subscribe: (_h: string, _l: string, cb: (d: unknown) => void) => {
        subs.push(cb);
        return { unsubscribe: () => subs.splice(subs.indexOf(cb), 1) };
      },
      get: vi.fn(async () => null),
    };
    return { hs: hs as never, subs };
  }
  const claim = {
    id: ID,
    holon: CHAT,
    kind: "group",
    name: "Orto chat",
    at: T0,
  };
  const pending = { hub: HUB, token: TOKEN, id: ID, at: T0 };

  spec(
    "fires once, when the chat's own signed acceptance checks out — retrying while it lands",
    async () => {
      vi.useFakeTimers();
      vi.setSystemTime(T0 + 1000);
      const { hs, subs } = fakeHs();
      const accepted = {
        chat: CHAT,
        anchor: "b".repeat(64),
        record: {
          id: ID,
          kind: "telegram",
          status: "accepted",
          peer: HUB,
          at: T0,
        },
      };
      let landed = false;
      const read = vi.fn(async (_hs: unknown, chat: string) =>
        landed && chat === CHAT ? accepted : null,
      );
      const onAccepted = vi.fn();
      const stop = watchTelegramLink(hs, pending, onAccepted, {
        read: read as never,
        pollMs: 60_000,
        retries: 3,
        retryMs: 100,
      });
      await vi.runOnlyPendingTimersAsync();
      subs.forEach((cb) => cb(claim));
      await vi.advanceTimersByTimeAsync(150);
      expect(onAccepted).not.toHaveBeenCalled(); // the acceptance is not there yet
      landed = true;
      await vi.advanceTimersByTimeAsync(150);
      expect(onAccepted).toHaveBeenCalledTimes(1);
      expect(onAccepted.mock.calls[0][0]).toBe(accepted);
      await vi.advanceTimersByTimeAsync(1000);
      expect(onAccepted).toHaveBeenCalledTimes(1);
      stop();
      vi.useRealTimers();
    },
  );

  spec(
    "reports a claim whose acceptance never verifies, and never fires",
    async () => {
      vi.useFakeTimers();
      vi.setSystemTime(T0 + 1000);
      const { hs, subs } = fakeHs();
      const onAccepted = vi.fn();
      const onFailed = vi.fn();
      const stop = watchTelegramLink(hs, pending, onAccepted, {
        read: async () => null,
        pollMs: 60_000,
        retries: 2,
        retryMs: 100,
        onFailed,
      });
      await vi.runOnlyPendingTimersAsync();
      subs.forEach((cb) => cb(claim));
      await vi.advanceTimersByTimeAsync(500);
      expect(onAccepted).not.toHaveBeenCalled();
      expect(onFailed).toHaveBeenCalledWith(CHAT);
      stop();
      vi.useRealTimers();
    },
  );
});
