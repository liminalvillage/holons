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
import { readGenes } from '../dna/genes.js';
import { dnaHash } from '../dna/version.js';
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
   * The DNA hash the request carries (its `dna` tag): the version of the
   * holon's DNA the person signed their agreement to. Absent: they agreed
   * to none. A newer request from the same key replaces it.
   */
  dna?: string;
  /** Unix seconds the request this answers was signed: a re-ask counts only when newer. */
  asked?: number;
  /**
   * `dna`: every onboarding step is done, but the request does not carry
   * the holon's current DNA hash, so the key waits — a fresh request with
   * the current hash lets it through (`mayLink`).
   */
  blocked?: 'dna';
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

/**
 * Note a request as announced (or already settled). Counts only from an
 * admin's key.
 *
 * A newer request from a key whose record is still pending (a re-ask: the
 * person walked a changed DNA again and signed its new hash) UPDATES that
 * record — its event, its `dna`, its time — and keeps everything else
 * (where the onboarding stands, the announcement). An older or the same
 * request leaves a pending record as it is.
 */
export async function recordJoinRequest(hs: HoloSphere, holon: string, request: JoinRequest, input: RecordJoinRequestInput = {}): Promise<JoinRequestRecord> {
  const now = (input.now ?? nowSec)();
  if (!input.status || input.status === 'pending') {
    let cur: JoinRequestRecord | undefined;
    try {
      cur = (await joinRequestRecords(hs, holon)).get(request.pubkey.toLowerCase());
    } catch {
      cur = undefined;
    }
    if (cur?.status === 'pending') {
      if (cur.eventId === request.eventId || (cur.asked ?? 0) >= request.at) return cur;
      const { dna: _old, blocked: _blocked, ...rest } = cur;
      const next: JoinRequestRecord = {
        ...rest,
        eventId: request.eventId,
        asked: request.at,
        at: now,
        ...(request.dna ? { dna: request.dna } : {}),
        ...(typeof input.messageId === 'number' ? { messageId: input.messageId } : {}),
      };
      await hs.put(holon, JOIN_REQUESTS_LENS, next);
      return next;
    }
  }
  const record: JoinRequestRecord = {
    id: request.pubkey,
    eventId: request.eventId,
    name: cleanName(input.name ?? request.reason),
    status: input.status ?? 'pending',
    at: now,
    asked: request.at,
    ...(request.dna ? { dna: request.dna } : {}),
    ...(typeof input.messageId === 'number' ? { messageId: input.messageId } : {}),
    ...(input.by !== undefined ? { by: String(input.by) } : {}),
    ...(input.telegramId ? { telegramId: input.telegramId } : {}),
  };
  await hs.put(holon, JOIN_REQUESTS_LENS, record);
  return record;
}

// ── The DNA a request agreed to ────────────────────────────────────────────

/**
 * Where a request stands with the holon's DNA as it is now:
 *   acknowledged   it carries the current DNA hash
 *   outdated       it carries an older one — the DNA changed since
 *   missing        it carries none, and the holon has a DNA to agree to
 *   none-required  the holon asks no agreement (no gene asks for one)
 *   unknown        the holon's DNA could not be read: nobody can say, so
 *                  nothing links on its own — never link on a guess
 */
export type JoinReadiness = 'acknowledged' | 'outdated' | 'missing' | 'none-required' | 'unknown';

/**
 * A request's (or its record's) standing with the DNA whose hash is
 * `current`: a hash, `null` when the holon asks no agreement, `undefined`
 * when its genes could not be read (→ `unknown`). Pure.
 */
export function joinReadiness(subject: { dna?: string | null } | null | undefined, current: string | null | undefined): JoinReadiness {
  if (current === undefined) return 'unknown';
  if (!current) return 'none-required';
  const signed = typeof subject?.dna === 'string' ? subject.dna.toLowerCase() : '';
  if (!signed) return 'missing';
  return signed === current.toLowerCase() ? 'acknowledged' : 'outdated';
}

/**
 * May this key be linked WITHOUT an admin deciding — by the Telegram bot's
 * proof, or at the end of an onboarding? Only with the current DNA agreed
 * to (or none to agree to) — never when the DNA could not be read
 * (`current` undefined). An admin who links by hand may still do so; every
 * admin list shows the readiness.
 */
export function mayLink(subject: { dna?: string | null } | null | undefined, current: string | null | undefined): boolean {
  const r = joinReadiness(subject, current);
  return r === 'acknowledged' || r === 'none-required';
}

/** The holon's DNA hash as this instance reads its genes (null: nothing to agree to). */
export async function holonDnaHash(hs: HoloSphere, holon: string): Promise<string | null> {
  return dnaHash(await readGenes(hs, holon));
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
  /** The request's standing with the holon's DNA as it is now; `unknown` when the genes could not be read. */
  dna: JoinReadiness;
}

export interface DescribeApplicantOptions {
  /** `NOSTR_DERIVATION_SECRET`: without it a Telegram claim stays unproven. */
  secret?: string;
  /** The holon's current DNA hash, when the caller has it; read from its genes otherwise. */
  dnaHash?: string | null;
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
  // Unreadable genes stay `undefined` → `unknown`: a read error must never
  // pass for "nothing to agree to" (that would let a key link on a guess).
  let current: string | null | undefined;
  if (opts.dnaHash !== undefined) current = opts.dnaHash;
  else {
    try {
      current = await holonDnaHash(hs, request.holon);
    } catch {
      current = undefined;
    }
  }
  return { name: name || shortId(request.pubkey), ...(telegram ? { telegram } : {}), dna: joinReadiness(request, current) };
}
