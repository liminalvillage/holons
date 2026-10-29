// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Answering join requests on a holon's behalf.
//
// A screen shows a holon's pending requests to whoever has Settings open. A
// service that answers for many holons (the Telegram bot) needs two more
// things, and both live here so every surface reads them the same way:
//
//   who is asking   `describeApplicant` — the name to show, and whether the
//                   Telegram identity the request claims is PROVEN: the key a
//                   Telegram login derives is the key that signed the request.
//   what was said   the `joinrequests` lens — one record per asking key:
//                   announced (pending), approved, declined — and, while a
//                   holon with an onboarding walks them through it, where
//                   they are (`@holons/core/onboarding`). It is the memory
//                   that stops a second announcement, and `approvedJoinKeys`
//                   is the list of keys an admin let in, which a roster sync
//                   must keep seated.
//
// An approval is a seating decision, so a record counts only when an ADMIN
// (as of its time) signed it — the `members` capability. The lens itself is
// last-writer-wins for any member; read through `joinRequestRecords`, a
// member's own "approved" is ignored.

import type { HoloSphere } from 'holosphere';
import { eventToItem } from 'holosphere/nostr-events.js';
import { deriveTelegramNostrKey } from '../auth/derive.js';
import { resolveHolonAuthority } from '../holosphere/authority.js';
import { may } from '../holosphere/capabilities.js';
import { cleanName, isPlaceholderName, shortId } from '../identity/ids.js';
import { createNameResolver, type ResolverHost } from '../identity/resolver.js';
import type { JoinRequest } from './index.js';

/** The lens holding what a holon answered to each asking key. */
export const JOIN_REQUESTS_LENS = 'joinrequests';

export type JoinRequestStatus = 'pending' | 'approved' | 'declined';

/** What the holon recorded about one asking key (id = the key). */
export interface JoinRequestRecord {
  id: string;
  /** The request this answers; a newer request from the same key is a new ask. */
  eventId: string;
  name: string;
  status: JoinRequestStatus;
  /** Unix seconds of the last change. */
  at: number;
  /** Where the surface announced it (a Telegram message id). */
  messageId?: number;
  /** Who settled it, in the surface's own terms (a Telegram user id). */
  by?: string;
  telegramId?: string;
  /**
   * Onboarding progress (`@holons/core/onboarding`), present while the holon
   * walks this key through its onboarding. `home` is the holon the person's
   * onboarding cards live in, `step` the step they are on, `confirmed` the
   * cards an admin vouched for. Admin-signed like the rest of the record, so
   * nobody advances themselves.
   */
  home?: string;
  step?: string;
  confirmed?: string[];
}

type StoreHost = HoloSphere & {
  store: {
    listEventIds(holon: string | null, lens: string): string[];
    getEvents(holon: string | null, lens: string, id: string): Array<{ pubkey: string; created_at: number }>;
  };
};

const HEX64 = /^[0-9a-f]{64}$/;
const nowSec = (): number => Math.floor(Date.now() / 1000);

/**
 * The records that count, by asking key: for each, the newest one signed by
 * a key that was an admin of the holon at that moment. A holon nobody speaks
 * for has no seats to grant, so it has none.
 */
export async function joinRequestRecords(hs: HoloSphere, holon: string): Promise<Map<string, JoinRequestRecord>> {
  const out = new Map<string, JoinRequestRecord>();
  try {
    await hs.getAll(holon, JOIN_REQUESTS_LENS); // sync the lens
  } catch {
    /* nothing readable: what the store holds decides */
  }
  const { actors } = resolveHolonAuthority(hs, holon);
  if (!actors) return out;
  const store = (hs as StoreHost).store;
  for (const id of store.listEventIds(holon, JOIN_REQUESTS_LENS)) {
    const key = String(id).toLowerCase();
    if (!HEX64.test(key)) continue;
    const newest = store
      .getEvents(holon, JOIN_REQUESTS_LENS, id)
      .filter((e) => may(actors.roleAt(String(e.pubkey).toLowerCase(), e.created_at), 'members'))
      .sort((a, b) => b.created_at - a.created_at)[0];
    if (!newest) continue;
    const item = eventToItem(newest as never) as (JoinRequestRecord & { _deleted?: boolean }) | null;
    if (!item || item._deleted === true) continue;
    out.set(key, { ...item, id: key });
  }
  return out;
}

/** The keys an admin approved and nobody has declined since — a roster sync keeps these seated. */
export async function approvedJoinKeys(hs: HoloSphere, holon: string): Promise<string[]> {
  return [...(await joinRequestRecords(hs, holon)).values()].filter((r) => r.status === 'approved').map((r) => r.id);
}

export interface RecordJoinRequestInput {
  name?: string;
  status?: JoinRequestStatus;
  messageId?: number;
  by?: string | number;
  telegramId?: string;
  /** Unix seconds; injectable for tests. */
  now?: () => number;
}

/** Note a request as announced (or already settled). Counts only from an admin's key. */
export async function recordJoinRequest(hs: HoloSphere, holon: string, request: JoinRequest, input: RecordJoinRequestInput = {}): Promise<JoinRequestRecord> {
  const record: JoinRequestRecord = {
    id: request.pubkey,
    eventId: request.eventId,
    name: cleanName(input.name ?? request.reason),
    status: input.status ?? 'pending',
    at: (input.now ?? nowSec)(),
    ...(typeof input.messageId === 'number' ? { messageId: input.messageId } : {}),
    ...(input.by !== undefined ? { by: String(input.by) } : {}),
    ...(input.telegramId ? { telegramId: input.telegramId } : {}),
  };
  await hs.put(holon, JOIN_REQUESTS_LENS, record);
  return record;
}

/**
 * Settle the request of `pubkey`: approved or declined, by whom. Null when
 * the holon holds no record for that key. Seating is `approveJoin`'s job —
 * this only remembers the decision.
 */
export async function settleJoinRequest(
  hs: HoloSphere,
  holon: string,
  pubkey: string,
  status: Exclude<JoinRequestStatus, 'pending'>,
  opts: { by?: string | number; now?: () => number } = {},
): Promise<JoinRequestRecord | null> {
  const cur = (await joinRequestRecords(hs, holon)).get(String(pubkey).toLowerCase());
  if (!cur) return null;
  const record: JoinRequestRecord = { ...cur, status, at: (opts.now ?? nowSec)(), ...(opts.by !== undefined ? { by: String(opts.by) } : {}) };
  await hs.put(holon, JOIN_REQUESTS_LENS, record);
  return record;
}

/** Who a request is from, as a surface shows it. */
export interface Applicant {
  /** The name they gave, else their Nostr profile's, else the short key. */
  name: string;
  /** The Telegram identity the request claims. `verified`: the claim is proven. */
  telegram?: { id: string; verified: boolean };
}

export interface DescribeApplicantOptions {
  /** `NOSTR_DERIVATION_SECRET`: without it a Telegram claim stays unproven. */
  secret?: string;
}

/**
 * Name an applicant and prove their Telegram claim. The proof needs no
 * trust in the request: a Telegram login's key is derived from the id with
 * the server's secret, so `derive(id) === the key that signed` holds only
 * for that Telegram user.
 */
export async function describeApplicant(hs: HoloSphere, request: JoinRequest, opts: DescribeApplicantOptions = {}): Promise<Applicant> {
  let telegram: Applicant['telegram'];
  if (request.telegramId) {
    let verified = false;
    if (opts.secret) {
      try {
        verified = deriveTelegramNostrKey(request.telegramId, opts.secret).publicKey === request.pubkey;
      } catch {
        verified = false;
      }
    }
    telegram = { id: request.telegramId, verified };
  }
  let name = cleanName(request.reason);
  if (!name || isPlaceholderName(name, request.pubkey)) {
    name = '';
    try {
      const names = await createNameResolver(hs as unknown as ResolverHost, { holon: request.holon }).resolve([request.pubkey]);
      const found = names.get(request.pubkey);
      if (found && !isPlaceholderName(found, request.pubkey)) name = found;
    } catch {
      /* no profile readable */
    }
  }
  return { name: name || shortId(request.pubkey), ...(telegram ? { telegram } : {}) };
}
