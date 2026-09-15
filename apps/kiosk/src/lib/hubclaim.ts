// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Starting a hub from this screen, without copying anything back.
//
// A hub is a Telegram chat, so "start a new hub" leaves for Telegram — and
// Telegram cannot hand anything back to the tab it left. The deep link CAN
// carry something out, though: a one-time claim token, which the bot
// redeems on the relay as "<token> → this chat" (`@holons/core/onboarding`).
// This module is the screen's side of that loop: mint the token, remember it
// while the person is away, build the two deep links, and watch the relay
// for the redemption so the hub docks itself the moment the bot answers.
//
// The pending token lives in localStorage beside the hand-off note (see
// config.ts): a person who comes back to the tab mid-flow — or reloads it —
// picks the wait back up instead of starting over.

import type { HoloSphere } from "holosphere";
import {
  CLAIM_LENS,
  CLAIM_MAX_AGE_MS,
  CLAIM_NAMESPACE,
  claimFor,
  claimPayload,
  isClaimToken,
  newClaimToken,
  readHubClaim,
  type HubClaim,
} from "@holons/core/onboarding";
import { addToGroupUrl, botChatUrl, markBotHandoff } from "./config";

const CLAIM_KEY = "kiosk_hub_claim";

/** A token this screen sent out and is still waiting on. */
export type PendingClaim = { token: string; at: number };

/** Parse the persisted note; null when absent, malformed, or too old. */
export function parsePendingClaim(
  raw: string | null,
  now = Date.now(),
): PendingClaim | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PendingClaim>;
    if (!isClaimToken(v.token)) return null;
    if (typeof v.at !== "number" || !Number.isFinite(v.at)) return null;
    if (now - v.at > CLAIM_MAX_AGE_MS || v.at > now + 60_000) return null;
    return { token: v.token, at: v.at };
  } catch {
    return null;
  }
}

/** The claim this device is waiting on, if any (a stale one is forgotten). */
export function pendingClaim(now = Date.now()): PendingClaim | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const p = parsePendingClaim(localStorage.getItem(CLAIM_KEY), now);
    if (!p) localStorage.removeItem(CLAIM_KEY);
    return p;
  } catch {
    return null;
  }
}

/**
 * Leaving for Telegram with `token` in the deep link: remember it, and leave
 * the hand-off note so the return leg opens the right step.
 */
export function beginHubClaim(
  token: string = newClaimToken(),
  now = Date.now(),
): PendingClaim {
  const p = { token, at: now };
  try {
    localStorage.setItem(CLAIM_KEY, JSON.stringify(p));
  } catch {
    /* private mode / quota — the wait just won't survive a reload */
  }
  markBotHandoff();
  return p;
}

/** The loop closed (or was abandoned): nothing to wait on any more. */
export function clearHubClaim(): void {
  try {
    localStorage.removeItem(CLAIM_KEY);
  } catch {
    /* ignore */
  }
}

/** The two ways out, each carrying the token: a chat with the bot, or a group. */
export function hubClaimUrls(token: string): {
  personal: string;
  group: string;
} {
  const payload = claimPayload(token);
  return { personal: botChatUrl(payload), group: addToGroupUrl(payload) };
}

/**
 * Watch the relay for the bot to redeem `token`; `onClaim` fires at most
 * once. A live subscription carries the record the moment it lands, and a
 * slow poll backs it up (a cold read can race the relay's catch-up). Returns
 * a stop function; stopping after the claim arrived is a no-op.
 */
export function watchHubClaim(
  holosphere: Promise<HoloSphere> | HoloSphere,
  token: string,
  onClaim: (claim: HubClaim) => void,
  opts: { pollMs?: number } = {},
): () => void {
  let active = true;
  let unsub: (() => void) | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    active = false;
    unsub?.();
    unsub = null;
    if (timer) clearInterval(timer);
    timer = null;
  };
  const found = (claim: HubClaim) => {
    if (!active) return;
    stop();
    onClaim(claim);
  };

  void (async () => {
    let hs: HoloSphere;
    try {
      hs = await holosphere;
    } catch {
      return;
    }
    if (!active) return;

    const raw: any = hs.subscribe(
      CLAIM_NAMESPACE,
      CLAIM_LENS,
      (data: unknown) => {
        const claim = claimFor(data, token);
        if (claim) found(claim);
      },
    );
    if (!active) {
      if (typeof raw?.unsubscribe === "function") raw.unsubscribe();
      else if (typeof raw === "function") raw();
      return;
    }
    unsub = () => {
      if (typeof raw?.unsubscribe === "function") raw.unsubscribe();
      else if (typeof raw === "function") raw();
    };

    const poll = async () => {
      if (!active) return;
      try {
        const claim = await readHubClaim(hs, token);
        if (claim) found(claim);
      } catch {
        /* relay hiccup — the next tick retries */
      }
    };
    void poll();
    timer = setInterval(poll, opts.pollMs ?? 5000);
  })();

  return stop;
}
