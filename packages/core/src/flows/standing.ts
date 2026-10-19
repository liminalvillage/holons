// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Standing — a party's word about their own seat, as signed, append-only
 * actions: the EXIT that retires it and the NEEDS flag that moves it.
 *
 * A share is a claim on everything that comes in later. Two choices, always:
 * HOLD, and the share stays, worth more as the pot fills; or EXIT — collect
 * what the table already owes and leave. An `exit` on the `flow_exits` log
 * is the second: from the next new-moon cut the party is in no bucket of
 * the node (`buckets.ts`), the remaining holders' shares grow, and the rows
 * the Pot already committed stay collectable (a table never decreases). It
 * is the party's own word — no attestation is needed (quorum 0 by default),
 * an attester may still dispute it — and it is said once: a second exit is
 * invalid.
 *
 * A `needs` flag on the `flow_needs` log says a member is in need, which the
 * needs floor of a split divides equally among. Being in need is a claim on
 * the others, so it is attested like a claim (quorum 1 by default); the
 * latest accepted word per party — `on` or `off` — is what counts.
 *
 * Two lenses, not one kind each on `flow_claims`: `collapse` applies one
 * policy per lens, and these need different quorums.
 *
 * The rules, in log order (`claims.ts` `signerFor`):
 *   - the signer acts for the party (`partyOf`, a partner's key for the
 *     partner holon), or is the holon key naming `onBehalfOf` (`delegated`);
 *   - the policy's quorum and disputes apply (`protocol.collapse`).
 *
 * Pure: entries in, standing out. Reading the logs is `standing-load.ts`.
 */

import {
  action,
  attestation,
  collapse,
  federatedActors,
  isAction,
  lensContext,
  type AcceptedActors,
  type Appendable,
  type AttestationRecord,
  type Judged,
  type LensContextInput,
  type LogEvent,
  type PartnerImport,
  type PartyResolver,
  type Policy,
} from '../protocol/index.js';
import { lunationAt } from './lunation.js';

/** The append-only lens exits live in. */
export const FLOW_EXITS_LENS = 'flow_exits';
/** The append-only lens needs flags live in. */
export const FLOW_NEEDS_LENS = 'flow_needs';

export interface ExitBody {
  t: 'action';
  kind: 'exit';
  /** The party retiring their seat. */
  party: string;
  /** The lunar cycle the exit was signed in (`lunationAt().index`); it applies at the next cut. */
  epoch: number;
  memo?: string;
  /** Set when the holon key exits for a party (the bot on a member's word). */
  onBehalfOf?: string;
}

export interface NeedsBody {
  t: 'action';
  kind: 'needs';
  party: string;
  /** True: in need from now on; false: no longer. */
  on: boolean;
  epoch: number;
  memo?: string;
  onBehalfOf?: string;
}

export type StandingStatus = 'accepted' | 'pending' | 'disputed' | 'conflict' | 'rejected';

/** One judged entry of either log. */
export interface StandingEntry {
  id: string;
  kind: 'exit' | 'needs';
  party: string;
  /** Needs only. */
  on?: boolean;
  epoch: number;
  memo?: string;
  /** Unix seconds. */
  createdAt: number;
  pubkey: string;
  /** True when the holon key signed for the party. */
  delegated: boolean;
  /** The partner holon whose log the entry came from, when imported. */
  origin?: string;
  status: StandingStatus;
  reason?: string;
  attests: number;
  disputes: number;
}

/** What a split reads: who left, who is in need. */
export interface Standing {
  /** Party → the accepted exit. */
  exited: Record<string, { id: string; epoch: number; createdAt: number }>;
  /** Party → the accepted flag that put them in need. */
  inNeed: Record<string, { id: string; epoch: number; createdAt: number }>;
}

export const EMPTY_STANDING: Readonly<Standing> = Object.freeze({ exited: Object.freeze({}), inNeed: Object.freeze({}) }) as Standing;

export interface FoldedStanding {
  /** Every entry of the log in log order, judged. */
  entries: StandingEntry[];
  /** The entries that count, in log order — what a checkpoint covers. */
  accepted: LogEvent<unknown>[];
  source: AcceptedActors['source'];
  policy: Policy;
  imports: Array<{ holon: string; source: AcceptedActors['source']; accepted: number; pending: number; rejected: number }>;
}

export interface FoldedExits extends FoldedStanding {
  exited: Standing['exited'];
}

export interface FoldedNeeds extends FoldedStanding {
  inNeed: Standing['inNeed'];
}

export interface BuildExitInput {
  party: string;
  memo?: string;
  /** When the exit is signed (ms). Default now. Sets the epoch. */
  at?: number;
  /** The party's previous entry, to chain. */
  prev?: string;
  onBehalfOf?: string;
}

/** The `exit` action a party appends to retire their seat. */
export function buildExit(input: BuildExitInput): Appendable<ExitBody> {
  const at = input.at ?? Date.now();
  const party = String(input.party ?? '').trim();
  if (!party) throw new Error('An exit names the party leaving');
  const body: Omit<ExitBody, 't' | 'kind'> = {
    party,
    epoch: lunationAt(at).index,
    ...(input.memo ? { memo: String(input.memo) } : {}),
    ...(input.onBehalfOf ? { onBehalfOf: String(input.onBehalfOf) } : {}),
  };
  return action('exit', body as Record<string, unknown>, input.prev ? { prev: input.prev } : undefined) as unknown as Appendable<ExitBody>;
}

export interface BuildNeedsInput extends BuildExitInput {
  on: boolean;
}

/** The `needs` action a party appends to say they are — or are no longer — in need. */
export function buildNeeds(input: BuildNeedsInput): Appendable<NeedsBody> {
  const at = input.at ?? Date.now();
  const party = String(input.party ?? '').trim();
  if (!party) throw new Error('A needs flag names the party');
  const body: Omit<NeedsBody, 't' | 'kind'> = {
    party,
    on: !!input.on,
    epoch: lunationAt(at).index,
    ...(input.memo ? { memo: String(input.memo) } : {}),
    ...(input.onBehalfOf ? { onBehalfOf: String(input.onBehalfOf) } : {}),
  };
  return action('needs', body as Record<string, unknown>, input.prev ? { prev: input.prev } : undefined) as unknown as Appendable<NeedsBody>;
}

/** An attester's word on an exit or a needs flag. */
export function buildStandingVerdict(entryId: string, verdict: 'attest' | 'dispute', reason?: string): Appendable<AttestationRecord> {
  return attestation(entryId, verdict, reason);
}

export const isExit = (item: unknown): item is ExitBody => isAction(item) && item.kind === 'exit';
export const isNeeds = (item: unknown): item is NeedsBody => isAction(item) && item.kind === 'needs';

export interface FoldStandingInput {
  entries: Iterable<LogEvent<unknown>>;
  actors: AcceptedActors;
  policy?: Partial<Policy> | null;
  /** Which party a signing key acts for. */
  partyOf: (pubkey: string) => string | null | undefined;
  /** The holon's own key, allowed to act `onBehalfOf` a party. */
  holonPubkey?: string | null;
  /** Partner logs, each already judged by the partner's own rules (`importPartnerLog`). */
  imports?: Iterable<PartnerImport> | null;
}

type Seen = Map<string, { id: string; epoch: number; createdAt: number }>;

/** The shared fold: who may speak for whom, and the judged list. */
function foldStanding(
  kind: 'exit' | 'needs',
  input: FoldStandingInput,
): { result: ReturnType<typeof collapse<unknown, { seen: Seen }>>; entries: StandingEntry[]; imports: PartnerImport[]; holonKey: string | null; actors: ReturnType<typeof federatedActors> } {
  const holonKey = input.holonPubkey?.toLowerCase() ?? null;
  const imports = [...(input.imports ?? [])];
  const actors = federatedActors(input.actors, imports);
  const partyOf = (pubkey: string, at: number) => {
    const origin = actors.originOf(pubkey, at);
    if (origin) return origin;
    const p = input.partyOf(pubkey);
    return p == null ? null : String(p);
  };
  const entries: LogEvent<unknown>[] = [...input.entries];
  for (const p of imports) entries.push(...p.accepted);

  const isKind = kind === 'exit' ? isExit : isNeeds;

  const signerFor = (e: LogEvent<unknown>, party: string, onBehalfOf: unknown): string | null => {
    const delegated = !!holonKey && e.pubkey.toLowerCase() === holonKey && !!onBehalfOf;
    if (delegated) return String(onBehalfOf) === party ? null : 'party-mismatch';
    const actsFor = partyOf(e.pubkey, e.created_at);
    if (!actsFor) return 'unknown-party';
    return actsFor === party ? null : 'party-mismatch';
  };

  const result = collapse<unknown, { seen: Seen }>({
    entries,
    actors,
    policy: input.policy,
    initial: { seen: new Map() },
    validate: (e, state) => {
      if (!isKind(e.item)) return 'unknown-kind';
      const party = String((e.item as ExitBody | NeedsBody).party ?? '').trim();
      if (!party) return 'no-party';
      const who = signerFor(e, party, (e.item as ExitBody).onBehalfOf);
      if (who) return who;
      if (kind === 'exit' && state.seen.has(party)) return 'already-exited';
      if (kind === 'needs' && typeof (e.item as NeedsBody).on !== 'boolean') return 'bad-flag';
      return null;
    },
    fold: (state, e) => {
      const body = e.item as ExitBody | NeedsBody;
      const party = String(body.party).trim();
      const mark = { id: e.id, epoch: Number(body.epoch), createdAt: e.created_at };
      if (kind === 'exit') state.seen.set(party, mark);
      else if ((body as NeedsBody).on) state.seen.set(party, mark);
      else state.seen.delete(party);
      return state;
    },
  });

  const statusOf = (j: Judged<unknown>): { status: StandingStatus; reason?: string } => {
    if (j.status === 'accepted') return { status: 'accepted' };
    if (j.status === 'rejected') return { status: 'rejected', reason: j.detail ?? j.reason ?? undefined };
    if (j.reason === 'disputed') return { status: 'disputed' };
    if (j.reason === 'conflict') return { status: 'conflict' };
    return { status: 'pending', reason: j.detail ?? j.reason ?? undefined };
  };

  const judged: StandingEntry[] = [];
  for (const j of result.judged.values()) {
    if (!isKind(j.entry.item)) continue;
    const body = j.entry.item as ExitBody | NeedsBody;
    const { status, reason } = statusOf(j);
    const origin = actors.originOf(j.entry.pubkey, j.entry.created_at);
    judged.push({
      id: j.entry.id,
      kind,
      party: String(body.party),
      ...(kind === 'needs' ? { on: !!(body as NeedsBody).on } : {}),
      epoch: Number(body.epoch),
      ...(body.memo ? { memo: String(body.memo) } : {}),
      createdAt: j.entry.created_at,
      pubkey: j.entry.pubkey,
      delegated: !!holonKey && j.entry.pubkey.toLowerCase() === holonKey && !!body.onBehalfOf,
      ...(origin ? { origin } : {}),
      status,
      ...(reason ? { reason } : {}),
      attests: j.attests,
      disputes: j.disputes,
    });
  }
  judged.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  return { result, entries: judged, imports, holonKey, actors };
}

const summary = (imports: PartnerImport[]) => imports.map((p) => ({ holon: p.holon, source: p.source, accepted: p.accepted.length, pending: p.pending, rejected: p.rejected }));

/** Fold the `flow_exits` log: who retired their seat. */
export function foldExits(input: FoldStandingInput): FoldedExits {
  const { result, entries, imports } = foldStanding('exit', input);
  return {
    entries,
    accepted: result.accepted,
    exited: Object.fromEntries(result.state.seen),
    source: result.source,
    policy: result.policy,
    imports: summary(imports),
  };
}

/** Fold the `flow_needs` log: who is in need now. */
export function foldNeeds(input: FoldStandingInput): FoldedNeeds {
  const { result, entries, imports } = foldStanding('needs', input);
  return {
    entries,
    accepted: result.accepted,
    inNeed: Object.fromEntries(result.state.seen),
    source: result.source,
    policy: result.policy,
    imports: summary(imports),
  };
}

// ── From lens data to a folded statement ─────────────────────────────────

export interface StandingFromLensesInput extends LensContextInput {
  /** The `flow_exits` log (`getLog`). */
  exits: Iterable<LogEvent<unknown>>;
  /** The `flow_needs` log (`getLog`). */
  needs: Iterable<LogEvent<unknown>>;
  exitImports?: Iterable<PartnerImport> | null;
  needsImports?: Iterable<PartnerImport> | null;
}

export interface StandingContext {
  standing: Standing;
  exits: FoldedExits;
  needs: FoldedNeeds;
  actors: AcceptedActors;
  parties: PartyResolver;
  policy: { exits: Policy; needs: Policy };
  holonPubkey: string | null;
}

/** Fold both logs with the signer set and party map the lenses give — one function for every surface. */
export function foldStandingFromLenses(input: StandingFromLensesInput): StandingContext {
  const ctx = lensContext(input);
  const exitPolicy = ctx.policyFor(FLOW_EXITS_LENS);
  const needsPolicy = ctx.policyFor(FLOW_NEEDS_LENS);
  const common = { actors: ctx.actors, partyOf: ctx.parties.partyOf, holonPubkey: ctx.holonPubkey };
  const exits = foldExits({ entries: input.exits, policy: exitPolicy, imports: input.exitImports, ...common });
  const needs = foldNeeds({ entries: input.needs, policy: needsPolicy, imports: input.needsImports, ...common });
  return {
    standing: { exited: exits.exited, inNeed: needs.inNeed },
    exits,
    needs,
    actors: ctx.actors,
    parties: ctx.parties,
    policy: { exits: exitPolicy, needs: needsPolicy },
    holonPubkey: ctx.holonPubkey,
  };
}
