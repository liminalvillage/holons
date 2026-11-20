// SPDX-License-Identifier: AGPL-3.0-or-later
//
// People asking to be linked to this board's holon, waiting for its admins.
// A holon with no Telegram group has no bot to post the ask anywhere, so the
// screen itself must say so: this module keeps the list current for the
// bound board, and the account button, the gear and Settings → Members all
// read it. Followed only while this key could answer (the `members`
// capability — the layout decides), so nobody else is shown a badge.
// Meaning (which requests count, who is already linked) is core's
// (`watchJoinRequests`, via $lib/hubmembers).

import { writable } from "svelte/store";
import { isHolonId, isTelegramChatId } from "@holons/core/protocol";
import { dismissJoin, watchRequests, type ReadiedRequest } from "./hubmembers";

/** The pending asks of the bound board — empty unless this key can answer them. */
export const joinAsks = writable<ReadiedRequest[]>([]);

type Watch = typeof watchRequests;

let boundKey = "";
let stopBound: (() => void) | null = null;

/**
 * Follow `holon`'s join requests while this key may answer them; anyone
 * else sees none. Idempotent per (holon, canAnswer). Only holons that keep
 * a members log are asked (a keyed holon or a Telegram chat).
 */
export function bindJoinAsks(
  holon: string | null,
  canAnswer: boolean,
  watch: Watch = watchRequests,
): void {
  const key =
    holon && canAnswer && (isHolonId(holon) || isTelegramChatId(holon))
      ? holon
      : "";
  if (key === boundKey) return;
  boundKey = key;
  stopBound?.();
  stopBound = null;
  joinAsks.set([]);
  if (!key) return;
  stopBound = watch(key, (list) => {
    if (boundKey === key) joinAsks.set(list);
  });
}

/** An ask was answered here (linked): it no longer waits. */
export function settleJoinAsk(pubkey: string): void {
  joinAsks.update((l) => l.filter((r) => r.pubkey !== pubkey));
}

/** Wave an ask away on this screen (NIP-29 has no decline event). */
export function dismissJoinAsk(holon: string, pubkey: string): void {
  dismissJoin(holon, pubkey);
  settleJoinAsk(pubkey);
}
