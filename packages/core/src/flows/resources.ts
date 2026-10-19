// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Resources — what reaches a holon that is not money, and money too, as one
 * of eight streams.
 *
 * Money is a detour: a giver pays a project, the project goes to market, and
 * the market sells it what it actually needed — space, tools, seeds, skills,
 * time. A RESOURCE GIFT says the thing itself arrived, at any level: the Pot,
 * a fund, a project, a person. Each gift names one of the eight forms of
 * capital the repo's CapitalGame plays with (`CAPITALS`), financial last and
 * one stream among eight.
 *
 * Gifts are signed, append-only entries on the RECIPIENT's own
 * `flow_resources` log:
 *
 *   give     — "this reached you". Anyone may say it: a giver is by
 *              definition not a member of the recipient, so this log does
 *              NOT run the usual author rule (as `applications.ts`).
 *   verdict  — an ADMIN of the recipient attests (received) or disputes
 *              (with a reason). The latest admin word counts. An admin's own
 *              `give` is received as written: they saw it arrive.
 *
 * What counts is what the recipient says it received, never what a giver
 * says it gave — so a forged gift moves nothing until the recipient signs
 * for it. That signature, the giver's own entry, and an optional evidence
 * link (`proof`) are a gift's proof, and every one of them is public.
 *
 * The RESOURCE BASE of a holon is its received gifts that are not money:
 * resources first, and the financial pipes follow (`bandwidthWeights`).
 * Counted, not valued: hours, square metres and seeds share no unit, and a
 * count is a rule anyone can check by reading the log.
 *
 * Pure: entries in, gifts out. Reading and writing is `resources-load.ts`.
 */

import {
  action,
  attestation,
  attestationTarget,
  attestationVerdict,
  isAction,
  isAttestation,
  type AcceptedActors,
  type Appendable,
  type AttestationRecord,
  type LogEvent,
} from '../protocol/index.js';
import { byLogOrder } from '../protocol/types.js';
import { lunationAt } from './lunation.js';

/**
 * The eight forms of capital, in the order they are told: the seven that are
 * not money, then financial — the same eight types as `CapitalGame`.
 */
export const CAPITALS = ['material', 'living', 'social', 'intellectual', 'experiential', 'cultural', 'spiritual', 'financial'] as const;
export type Capital = (typeof CAPITALS)[number];
export const FINANCIAL_CAPITAL: Capital = 'financial';

export const isCapital = (value: unknown): value is Capital => (CAPITALS as readonly string[]).includes(String(value));

/** A capital named loosely ("Material", " living ") as one of the eight, or null. */
export function normalizeCapital(value: unknown): Capital | null {
  const s = String(value ?? '').trim().toLowerCase();
  return isCapital(s) ? s : null;
}

/** The append-only lens gifts live in, on the recipient. */
export const FLOW_RESOURCES_LENS = 'flow_resources';
export const RESOURCE_NOTE_MAX = 500;
export const RESOURCE_PROOF_MAX = 500;

export interface GiveBody {
  t: 'action';
  kind: 'give';
  /** Who gave it: a holon id, a person's id, or a name the recipient knows them by. */
  from: string;
  /** How the giver would like to be called, when the recipient cannot know. */
  name?: string;
  capital: Capital;
  amount: number;
  /** What the amount counts: hours, m², kg, EUR, "days of access". */
  unit: string;
  /** What it was, in a few words: "workspace", "tool library", "design hours". */
  what?: string;
  note?: string;
  /** Evidence anyone can open: a photo, a receipt, a booking. */
  proof?: string;
  /** The recipient's resource offer this answers, when it does. */
  offer?: string;
  /** The lunar cycle it was given in (`lunationAt().index`). */
  epoch: number;
}

export type GiftStatus = 'pending' | 'received' | 'disputed';

export interface ResourceGift {
  /** The `give` entry. */
  id: string;
  from: string;
  name?: string;
  capital: Capital;
  amount: number;
  unit: string;
  what?: string;
  note?: string;
  proof?: string;
  offer?: string;
  epoch: number;
  /** Unix seconds. */
  createdAt: number;
  pubkey: string;
  /** The signer was seen to speak for the giver. */
  verified: boolean;
  status: GiftStatus;
  /** The admin's reason, when disputed. */
  reason?: string;
  /** When the status was last set by a verdict (unix seconds). */
  decidedAt?: number;
  /** The admin key that received or disputed it. */
  decidedBy?: string;
}

/** One holon's resource base: its received gifts, counted. */
export interface ResourceBase {
  /** Received gifts that are not money: what sets financial bandwidth. */
  count: number;
  /** Received gifts per capital, financial included. Only capitals with something in them. */
  byCapital: Partial<Record<Capital, number>>;
  /** Capital → unit → amount received. */
  amounts: Partial<Record<Capital, Record<string, number>>>;
  /** Distinct givers of what was received. */
  givers: number;
}

export const EMPTY_RESOURCE_BASE: Readonly<ResourceBase> = Object.freeze({ count: 0, byCapital: {}, amounts: {}, givers: 0 }) as ResourceBase;

export interface FoldedResources {
  /** Every gift, newest first. */
  gifts: ResourceGift[];
  received: ResourceGift[];
  pending: ResourceGift[];
  base: ResourceBase;
}

const clip = (raw: unknown, max: number): string | undefined => {
  const s = String(raw ?? '').trim().slice(0, max);
  return s || undefined;
};
const round = (v: number) => Math.round(v * 100) / 100;
const unitOf = (u: unknown) => String(u ?? '').trim().slice(0, 40);

export interface BuildGiftInput {
  from: string;
  name?: string;
  capital: Capital | string;
  amount: number;
  unit: string;
  what?: string;
  note?: string;
  proof?: string;
  offer?: string;
  /** When it was given (ms). Default now. Sets the epoch. */
  at?: number;
}

/** The `give` action appended to the recipient's log. */
export function buildGift(input: BuildGiftInput): Appendable<GiveBody> {
  const from = clip(input.from, 200);
  if (!from) throw new Error('A gift names who gave it');
  const capital = normalizeCapital(input.capital);
  if (!capital) throw new Error(`A gift is one of the eight capitals: ${CAPITALS.join(', ')}`);
  const amount = round(Number(input.amount));
  if (!(amount > 0)) throw new Error('A gift has a positive amount');
  const unit = unitOf(input.unit);
  if (!unit) throw new Error('A gift names its unit');
  const body: Omit<GiveBody, 't' | 'kind'> = {
    from,
    ...(clip(input.name, 120) ? { name: clip(input.name, 120) } : {}),
    capital,
    amount,
    unit,
    ...(clip(input.what, 120) ? { what: clip(input.what, 120) } : {}),
    ...(clip(input.note, RESOURCE_NOTE_MAX) ? { note: clip(input.note, RESOURCE_NOTE_MAX) } : {}),
    ...(clip(input.proof, RESOURCE_PROOF_MAX) ? { proof: clip(input.proof, RESOURCE_PROOF_MAX) } : {}),
    ...(clip(input.offer, 120) ? { offer: clip(input.offer, 120) } : {}),
    epoch: lunationAt(input.at ?? Date.now()).index,
  };
  return action('give', body as Record<string, unknown>) as unknown as Appendable<GiveBody>;
}

/** A recipient admin's word on a gift: received, or disputed with a reason. */
export function buildGiftVerdict(giftId: string, verdict: 'attest' | 'dispute', reason?: string): Appendable<AttestationRecord> {
  return attestation(giftId, verdict, clip(reason, RESOURCE_NOTE_MAX));
}

export const isGift = (item: unknown): item is GiveBody => isAction(item) && item.kind === 'give';

export interface FoldResourcesInput {
  entries: Iterable<LogEvent<unknown>>;
  /** The RECIPIENT's accepted signers: only its admins receive. */
  actors: AcceptedActors | null | undefined;
  /** Does this key speak for this party? Absent: nobody is verified. */
  actsFor?: (pubkey: string, party: string, at: number) => boolean;
}

/** Fold a `flow_resources` log into its gifts and the holon's resource base. */
export function foldResources(input: FoldResourcesInput): FoldedResources {
  const ordered = [...input.entries].sort(byLogOrder);
  const actsFor = (pubkey: string, party: string, at: number) => {
    try {
      return !!input.actsFor?.(pubkey, party, at);
    } catch {
      return false;
    }
  };
  const isAdmin = (e: LogEvent<unknown>) => input.actors?.roleAt(e.pubkey, e.created_at) === 'admin';

  const byId = new Map<string, ResourceGift>();
  for (const e of ordered) {
    if (!isGift(e.item)) continue;
    const g = e.item;
    const from = clip(g.from, 200);
    const capital = normalizeCapital(g.capital);
    const amount = Number(g.amount);
    const unit = unitOf(g.unit);
    // A malformed gift is not a gift: it is dropped, never guessed at.
    if (!from || !capital || !(amount > 0) || !unit) continue;
    const name = clip(g.name, 120);
    const what = clip(g.what, 120);
    const note = clip(g.note, RESOURCE_NOTE_MAX);
    const proof = clip(g.proof, RESOURCE_PROOF_MAX);
    const offer = clip(g.offer, 120);
    byId.set(e.id, {
      id: e.id,
      from,
      ...(name ? { name } : {}),
      capital,
      amount: round(amount),
      unit,
      ...(what ? { what } : {}),
      ...(note ? { note } : {}),
      ...(proof ? { proof } : {}),
      ...(offer ? { offer } : {}),
      epoch: Number(g.epoch) || 0,
      createdAt: e.created_at,
      pubkey: e.pubkey,
      verified: actsFor(e.pubkey, from, e.created_at),
      status: isAdmin(e) ? 'received' : 'pending',
    });
  }

  // Every admin word on a gift, in log order: the last one stands.
  for (const e of ordered) {
    if (!isAttestation(e.item)) continue;
    const target = byId.get(attestationTarget(e) ?? '');
    if (!target || !isAdmin(e) || e.created_at < target.createdAt) continue;
    const verdict = attestationVerdict(e);
    if (!verdict) continue;
    target.status = verdict === 'attest' ? 'received' : 'disputed';
    target.decidedAt = e.created_at;
    target.decidedBy = e.pubkey;
    const reason = clip(e.item.reason, RESOURCE_NOTE_MAX);
    if (verdict === 'dispute' && reason) target.reason = reason;
    else delete target.reason;
  }

  const gifts = [...byId.values()].sort((a, z) => z.createdAt - a.createdAt || (a.id < z.id ? -1 : 1));
  const received = gifts.filter((g) => g.status === 'received');
  return {
    gifts,
    received,
    pending: gifts.filter((g) => g.status === 'pending'),
    base: resourceBaseOf(received),
  };
}

/** Count received gifts into a resource base. Gifts not received are ignored. */
export function resourceBaseOf(gifts: Iterable<Pick<ResourceGift, 'from' | 'capital' | 'amount' | 'unit'> & { status?: GiftStatus }>): ResourceBase {
  const base: ResourceBase = { count: 0, byCapital: {}, amounts: {}, givers: 0 };
  const givers = new Set<string>();
  for (const g of gifts) {
    if (g.status && g.status !== 'received') continue;
    const capital = normalizeCapital(g.capital);
    if (!capital) continue;
    if (capital !== FINANCIAL_CAPITAL) base.count++;
    base.byCapital[capital] = (base.byCapital[capital] ?? 0) + 1;
    const units = (base.amounts[capital] ??= {});
    units[g.unit] = round((units[g.unit] ?? 0) + Number(g.amount));
    givers.add(g.from);
  }
  base.givers = givers.size;
  return base;
}

/** A base as eight counts in `CAPITALS` order — how the flow graph stores it. */
export function capitalCounts(byCapital: Partial<Record<Capital, number>> | null | undefined): number[] {
  return CAPITALS.map((c) => Math.max(0, Math.floor(Number(byCapital?.[c]) || 0)));
}

/** Eight counts in `CAPITALS` order back to a by-capital map (zeros dropped). */
export function capitalsFromCounts(counts: readonly unknown[] | null | undefined): Partial<Record<Capital, number>> {
  const out: Partial<Record<Capital, number>> = {};
  if (!Array.isArray(counts)) return out;
  CAPITALS.forEach((c, i) => {
    const n = Math.floor(Number(counts[i]) || 0);
    if (n > 0) out[c] = n;
  });
  return out;
}

/** The resource base the bandwidth rule reads off a by-capital count: everything but money. */
export function resourceCount(byCapital: Partial<Record<Capital, number>> | null | undefined): number {
  let n = 0;
  for (const c of CAPITALS) if (c !== FINANCIAL_CAPITAL) n += Math.max(0, Math.floor(Number(byCapital?.[c]) || 0));
  return n;
}

// ── The game: resources first, finance follows ───────────────────────────

/**
 * The public rule: resource base → financial bandwidth.
 *
 * A fund that turns on `resourced` (0..100) sends that percent of its
 * exterior by resource base instead of by its zones: each placed project
 * gets the part of it its base is of all placed projects' bases. The rest
 * still follows the zones. With nobody resourced yet the whole exterior
 * follows the zones, so turning the rule on never strands money.
 *
 * Returns partner id → fraction of the resourced part (summing to 1), or an
 * empty map when no placed partner has a base.
 */
export function bandwidthWeights(bases: ReadonlyArray<{ id: string; resources?: number }>): Map<string, number> {
  const out = new Map<string, number>();
  let total = 0;
  for (const p of bases) {
    const n = Math.max(0, Number(p.resources) || 0);
    if (n > 0 && !out.has(p.id)) {
      out.set(p.id, n);
      total += n;
    }
  }
  if (total <= 0) return new Map();
  for (const [id, n] of out) out.set(id, n / total);
  return out;
}

export interface RankedParty {
  id: string;
  label: string;
  /** Received gifts that are not money. */
  count: number;
  byCapital: Partial<Record<Capital, number>>;
  /** 1-based; ties share a rank. */
  rank: number;
  /** The top two ranks are starred. */
  star: boolean;
}

/**
 * The most resourced rise: parties by resource base, most first, ties by the
 * number of capitals they were given, then by name. Parties with nothing are
 * left out. The top two ranks get a star.
 */
export function rankByResources(
  parties: Iterable<{ id: string; label: string; resources?: Partial<Record<Capital, number>> | null }>,
): RankedParty[] {
  const rows = [...parties]
    .map((p) => ({ id: p.id, label: p.label || p.id, byCapital: { ...(p.resources ?? {}) }, count: resourceCount(p.resources) }))
    .filter((p) => p.count > 0);
  const breadth = (p: { byCapital: Partial<Record<Capital, number>> }) => CAPITALS.filter((c) => c !== FINANCIAL_CAPITAL && (p.byCapital[c] ?? 0) > 0).length;
  rows.sort((a, z) => z.count - a.count || breadth(z) - breadth(a) || a.label.localeCompare(z.label) || (a.id < z.id ? -1 : 1));
  const ranked: RankedParty[] = [];
  rows.forEach((r, i) => {
    const prev = ranked[i - 1];
    const rank = prev && prev.count === r.count && breadth(rows[i - 1]) === breadth(r) ? prev.rank : i + 1;
    ranked.push({ ...r, rank, star: rank <= 2 });
  });
  return ranked;
}
