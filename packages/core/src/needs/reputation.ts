// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reputation on settlement — the whitepaper's second value pillar, attached
 * to the moment the handoff already owns.
 *
 * Each side of a fulfilled need may rate the other once. A rating is its OWN
 * record on the owner holon's quests lens (`<needId>~rating~<party>`), the
 * same replication lesson as handoff confirmations: new records travel
 * reliably across devices, nested-field merges on a shared record do not.
 * When the ratee lives on another holon (a provider who answered a federated
 * need), the record is mirrored there too — like settle's provider mirror —
 * so their reputation is computable from their own graph.
 *
 * Reputation itself is a pure fold: every rating record naming a user as
 * ratee, averaged. The historical records ARE the verifiable curriculum.
 */

import { NEED_RECORD_LENS, type PublishedNeed } from './types.js';
import { acceptedResponse, needPartyOf, type HandoffParty } from './responses.js';
import type { HandoffStoreLike } from './handoff.js';

export const NEED_RATING_TYPE = 'need-rating';

export interface NeedRatingRecord {
  id: string;
  type: typeof NEED_RATING_TYPE;
  needId: string;
  /** Which side rated — `requester` rates the provider and vice versa. */
  party: HandoffParty;
  rater: { id: string | number; name?: string; holonId?: string };
  ratee: { id: string | number; name?: string; holonId?: string };
  /** 1–5, integer. */
  stars: number;
  comment?: string;
  /** ISO timestamp. */
  at: string;
}

/** Per-need view of the ratings each side has left, folded from records. */
export type NeedRatings = Record<
  string,
  { requester?: NeedRatingRecord; provider?: NeedRatingRecord }
>;

export interface ReputationSummary {
  count: number;
  /** Mean stars over `count` ratings; 0 when there are none. */
  average: number;
}

/** Stable id of one side's rating record — one rating per side per need. */
export function needRatingId(needId: string, party: HandoffParty): string {
  return `${needId}~rating~${party}`;
}

export function isNeedRating(rec: unknown): rec is NeedRatingRecord {
  const r = rec as NeedRatingRecord | null;
  return Boolean(
    r &&
      r.type === NEED_RATING_TYPE &&
      r.needId &&
      (r.party === 'requester' || r.party === 'provider') &&
      typeof r.stars === 'number' &&
      r.ratee?.id != null
  );
}

export interface BuildNeedRatingOptions {
  comment?: string;
  now?: number;
  /**
   * The need's key on the OWNER holon (`sourceRef(...).key` for a record
   * reached through federation/holograms). Defaults to `need.id`.
   */
  key?: string;
}

export interface NeedRatingRejection {
  ok: false;
  reason: 'bad_stars' | 'not_fulfilled' | 'no_claimed_response' | 'not_a_party';
}

export type BuildNeedRatingResult =
  | { ok: true; record: NeedRatingRecord }
  | NeedRatingRejection;

/**
 * Validate and build the acting user's rating of the other side of a
 * fulfilled need. Which side they are — and therefore who they rate — is
 * derived from the need itself (`needPartyOf`), never taken on faith from
 * the caller: a user who is neither requester nor provider cannot rate.
 */
export function buildNeedRating(
  need: PublishedNeed,
  by: { id: string | number },
  stars: number,
  opts: BuildNeedRatingOptions = {}
): BuildNeedRatingResult {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return { ok: false, reason: 'bad_stars' };
  }
  if (need.status !== 'fulfilled') {
    return { ok: false, reason: 'not_fulfilled' };
  }
  const accepted = acceptedResponse(need);
  if (!accepted?.responder || accepted.responder.id == null || need.initiator?.id == null) {
    return { ok: false, reason: 'no_claimed_response' };
  }
  const party = needPartyOf(need, by?.id);
  if (!party) {
    return { ok: false, reason: 'not_a_party' };
  }

  // The requester's reputation lives on the owner holon (their need's home);
  // the provider's follows their own holon via the mirror.
  const requester = {
    id: need.initiator.id,
    ...(need.initiator.username ? { name: String(need.initiator.username) } : {}),
  };
  const provider = {
    id: accepted.responder.id,
    ...(accepted.responder.name ? { name: String(accepted.responder.name) } : {}),
    ...(accepted.responder.holonId ? { holonId: String(accepted.responder.holonId) } : {}),
  };
  const [rater, ratee] =
    party === 'requester' ? [requester, provider] : [provider, requester];

  const key = String(opts.key ?? need.id ?? '');
  return {
    ok: true,
    record: {
      id: needRatingId(key, party),
      type: NEED_RATING_TYPE,
      needId: key,
      party,
      rater,
      ratee,
      stars,
      ...(opts.comment ? { comment: opts.comment } : {}),
      at: new Date(opts.now ?? Date.now()).toISOString(),
    },
  };
}

/**
 * Fold a lens's worth of records into per-need rating state. Non-rating
 * records are ignored, so callers can pass the whole quests lens.
 */
export function foldNeedRatings(records: unknown[]): NeedRatings {
  const map: NeedRatings = {};
  for (const rec of records ?? []) {
    if (!isNeedRating(rec)) continue;
    const entry = (map[String(rec.needId)] ??= {});
    entry[rec.party] = rec;
  }
  return map;
}

/**
 * Reputation per user: every rating record naming them as ratee, averaged.
 * Replicated copies of the same record (owner + mirror + federation) count
 * once — deduped by record id.
 */
export function reputationByUser(records: unknown[]): Record<string, ReputationSummary> {
  const seen = new Set<string>();
  const sums: Record<string, { count: number; total: number }> = {};
  for (const rec of records ?? []) {
    if (!isNeedRating(rec)) continue;
    const id = String(rec.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const ratee = String(rec.ratee.id);
    const entry = (sums[ratee] ??= { count: 0, total: 0 });
    entry.count += 1;
    entry.total += rec.stars;
  }
  const out: Record<string, ReputationSummary> = {};
  for (const [user, { count, total }] of Object.entries(sums)) {
    out[user] = { count, average: total / count };
  }
  return out;
}

/** One user's reputation, in a single pass — no per-user map materialized. */
export function reputationOf(records: unknown[], userId: string | number): ReputationSummary {
  const wanted = String(userId);
  const seen = new Set<string>();
  let count = 0;
  let total = 0;
  for (const rec of records ?? []) {
    if (!isNeedRating(rec) || String(rec.ratee.id) !== wanted) continue;
    const id = String(rec.id);
    if (seen.has(id)) continue;
    seen.add(id);
    count += 1;
    total += rec.stars;
  }
  return { count, average: count ? total / count : 0 };
}

export interface RateNeedOptions extends BuildNeedRatingOptions {
  /** Mirror the record to the ratee's holon when it differs. Default true. */
  mirrorToRatee?: boolean;
}

export type RateNeedResult =
  | { ok: true; record: NeedRatingRecord; errors: string[] }
  | NeedRatingRejection;

/**
 * The acting user rates the other side after settlement: validate, persist
 * the rating record on the owner holon, and mirror it to the ratee's own
 * holon so a federated provider's reputation is visible in their own graph.
 * The mirror is best-effort — its failure is reported, not fatal.
 */
export async function rateNeedHandoff(
  db: HandoffStoreLike,
  ownerHolonId: string,
  need: PublishedNeed,
  by: { id: string | number },
  stars: number,
  opts: RateNeedOptions = {}
): Promise<RateNeedResult> {
  const built = buildNeedRating(need, by, stars, opts);
  if (!built.ok) return built;

  const errors: string[] = [];
  await db.put(ownerHolonId, NEED_RECORD_LENS, built.record);

  const rateeHolon = built.record.ratee.holonId;
  if (opts.mirrorToRatee !== false && rateeHolon && rateeHolon !== ownerHolonId) {
    try {
      await db.put(rateeHolon, NEED_RECORD_LENS, built.record);
    } catch (err) {
      errors.push(`mirror rating: ${(err as Error).message ?? String(err)}`);
    }
  }
  return { ok: true, record: built.record, errors };
}
