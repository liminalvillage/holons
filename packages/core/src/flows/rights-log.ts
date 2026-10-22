// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The published rights table — the entry a Pot's root points back to.
 *
 * A root on-chain is only a promise; the table behind it must be where every
 * claimant can read it to build a proof, and where every reviewer can rebuild
 * it during the challenge window. So the table is appended to the holon's
 * `flow_rights` log (kind 1808, append-only, signed) and the entry's id is the
 * `tableRef` the Pot stores. Relays are the data availability layer; a root
 * whose table nobody can find gets vetoed.
 *
 * The rules, in log order (`protocol.collapse`):
 *   - only an attester publishes a table: committing rights is the same trust
 *     as minting or paying;
 *   - a table names its Pot and chain, has an epoch after the last accepted
 *     table for that Pot, never lowers a row or a total, and its rows add up
 *     to its totals (`rightsRegression`);
 *   - the policy's quorum and disputes apply, so a wrong table is voided by a
 *     word before any signer puts it on-chain.
 *
 * Amounts travel as decimal strings: base units exceed Number and JSON has no
 * bigint. Pure: entries in, judged tables out. Reading the log is a surface's
 * `getLog`.
 */

import {
  action,
  attestation,
  attestationTarget,
  collapse,
  isAction,
  isAttestation,
  lensContext,
  normalizePolicy,
  type AcceptedActors,
  type Appendable,
  type AttestationRecord,
  type LensContextInput,
  type LogEvent,
  type Policy,
} from '../protocol/index.js';
import { normalizeAddress, rightsRegression, type RightsRow, type RightsTable } from './rights.js';
import { rightsRoot } from './rights-tree.js';

/** The append-only lens rights tables live in. */
export const FLOW_RIGHTS_LENS = 'flow_rights';

export interface RightsBody {
  t: 'action';
  kind: 'rights';
  epoch: number;
  chainId: number;
  /** The Pot the table is for, lower-cased. */
  pot: string;
  /** The root the Pot will be handed, so a reader can check the rows against it. */
  root: string;
  /** Token → total, base units as a decimal string. */
  totals: Record<string, string>;
  rows: Array<{ party: string; to: string; token: string; cumulative: string }>;
  /** The settings entries (event ids) the split was read from, one per holon in the cascade. */
  sources?: string[];
  memo?: string;
}

export type RightsStatus = 'committed' | 'pending' | 'disputed' | 'conflict' | 'rejected';

export interface PublishedRights {
  id: string;
  epoch: number;
  chainId: number;
  pot: string;
  root: string;
  table: RightsTable;
  sources: string[];
  memo?: string;
  createdAt: number;
  pubkey: string;
  status: RightsStatus;
  reason?: string;
  attests: number;
  disputes: number;
}

export interface FoldedRights {
  /** Every published table in log order, judged. */
  tables: PublishedRights[];
  accepted: LogEvent<unknown>[];
  /** `chainId:pot` → the latest accepted table. */
  latest: Record<string, PublishedRights>;
  source: AcceptedActors['source'];
  policy: Policy;
}

const potKey = (chainId: number, pot: string) => `${chainId}:${pot}`;

/** The `rights` action an attester appends to publish a table. */
export function buildRightsEntry(input: {
  table: RightsTable;
  chainId: number;
  pot: string;
  sources?: string[];
  memo?: string;
  prev?: string;
}): Appendable<RightsBody> {
  const pot = normalizeAddress(input.pot);
  if (!pot) throw new Error('The Pot needs a 0x address');
  const body: Omit<RightsBody, 't' | 'kind'> = {
    epoch: input.table.epoch,
    chainId: Math.floor(Number(input.chainId)),
    pot,
    root: rightsRoot(input.table.rows),
    totals: Object.fromEntries(Object.entries(input.table.totals).map(([t, v]) => [t, v.toString()])),
    rows: input.table.rows.map((r) => ({ party: r.party, to: r.to, token: r.token, cumulative: r.cumulative.toString() })),
    ...(input.sources?.length ? { sources: [...input.sources] } : {}),
    ...(input.memo ? { memo: String(input.memo) } : {}),
  };
  return action('rights', body as Record<string, unknown>, input.prev ? { prev: input.prev } : undefined) as unknown as Appendable<RightsBody>;
}

export const isRights = (item: unknown): item is RightsBody => isAction(item) && item.kind === 'rights';

/** An attestation that also carries the signer's wallet signature over the Pot's `Root` digest. */
export interface RightsSignature extends AttestationRecord {
  /** The wallet that signed, lower-cased. */
  signer: string;
  /** The EIP-712 signature, 0x hex. */
  signature: string;
}

/**
 * A signer's word on a table, with their wallet signature riding along: the
 * attestation counts toward the log's quorum as any attestation does, and
 * the signature is what `postRoot` takes. One entry, two quorums.
 */
export function buildRightsSignature(tableId: string, input: { signer: string; signature: string; reason?: string }): Appendable<RightsSignature> {
  const signer = normalizeAddress(input.signer);
  const signature = String(input.signature ?? '').trim();
  if (!signer) throw new Error('A signer is a 0x address');
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('A signature is 65 bytes of hex');
  const base = attestation(tableId, 'attest', input.reason);
  return { ...base, item: { ...base.item, signer, signature: signature.toLowerCase() } };
}

export const isRightsSignature = (item: unknown): item is RightsSignature =>
  isAttestation(item) && typeof (item as RightsSignature).signer === 'string' && typeof (item as RightsSignature).signature === 'string';

/** The wallet signatures the log holds for `tableId`, one per signer (the latest), for `orderSignatures`. */
export function rootSignatures(entries: Iterable<LogEvent<unknown>>, tableId: string): Array<{ signer: string; signature: string; pubkey: string }> {
  const bySigner = new Map<string, { signer: string; signature: string; pubkey: string; at: number }>();
  for (const e of entries) {
    if (!isRightsSignature(e.item) || attestationTarget(e) !== tableId) continue;
    const signer = normalizeAddress(e.item.signer);
    if (!signer) continue;
    const seen = bySigner.get(signer);
    if (!seen || seen.at < e.created_at) bySigner.set(signer, { signer, signature: e.item.signature, pubkey: e.pubkey, at: e.created_at });
  }
  return [...bySigner.values()].map(({ at: _at, ...rest }) => rest);
}

const asBig = (v: unknown): bigint | null => {
  try {
    const b = BigInt(String(v));
    return b < 0n ? null : b;
  } catch {
    return null;
  }
};

/** The table a published body carries, or null when it is malformed. */
export function tableOf(body: RightsBody): RightsTable | null {
  const epoch = Math.floor(Number(body.epoch));
  if (!Number.isFinite(epoch)) return null;
  const rows: RightsRow[] = [];
  for (const r of body.rows ?? []) {
    const to = normalizeAddress(r.to);
    const token = normalizeAddress(r.token);
    const cumulative = asBig(r.cumulative);
    if (!r.party || !to || !token || cumulative == null) return null;
    rows.push({ party: String(r.party), to, token, cumulative });
  }
  const totals: Record<string, bigint> = {};
  for (const [t, v] of Object.entries(body.totals ?? {})) {
    const token = normalizeAddress(t);
    const total = asBig(v);
    if (!token || total == null) return null;
    totals[token] = total;
  }
  rows.sort((a, b) => (a.party < b.party ? -1 : a.party > b.party ? 1 : a.token < b.token ? -1 : a.token > b.token ? 1 : 0));
  return { epoch, rows, totals };
}

export interface FoldRightsInput {
  entries: Iterable<LogEvent<unknown>>;
  actors: AcceptedActors;
  policy?: Partial<Policy> | null;
}

/** Fold the `flow_rights` log into the latest accepted table per Pot. */
export function foldRights(input: FoldRightsInput): FoldedRights {
  const attesterRoles = new Set(normalizePolicy(input.policy).attesters);
  const actors = input.actors;
  type State = Record<string, RightsTable>;

  const parsed = new Map<string, { table: RightsTable; pot: string; chainId: number }>();
  const result = collapse<unknown, State>({
    entries: input.entries,
    actors,
    policy: input.policy,
    initial: {},
    validate: (e, state) => {
      if (!isRights(e.item)) return 'unknown-kind';
      const role = actors.roleAt(e.pubkey, e.created_at);
      if (!role || !attesterRoles.has(role)) return 'not-attester';
      const pot = normalizeAddress(e.item.pot);
      const chainId = Math.floor(Number(e.item.chainId));
      if (!pot || !Number.isFinite(chainId) || chainId <= 0) return 'no-pot';
      const table = tableOf(e.item);
      if (!table) return 'bad-table';
      if (rightsRoot(table.rows).toLowerCase() !== String(e.item.root ?? '').toLowerCase()) return 'root-mismatch';
      const problems = rightsRegression(state[potKey(chainId, pot)] ?? null, table);
      if (problems.length) return `regression: ${problems[0]}`;
      parsed.set(e.id, { table, pot, chainId });
      return null;
    },
    fold: (state, e) => {
      const p = parsed.get(e.id);
      if (p) state[potKey(p.chainId, p.pot)] = p.table;
      return state;
    },
  });

  const tables: PublishedRights[] = [];
  const latest: Record<string, PublishedRights> = {};
  for (const j of result.judged.values()) {
    if (!isRights(j.entry.item)) continue;
    const body = j.entry.item;
    let status: RightsStatus;
    let reason: string | undefined;
    if (j.status === 'accepted') status = 'committed';
    else if (j.status === 'rejected') {
      status = 'rejected';
      reason = j.detail ?? j.reason ?? undefined;
    } else if (j.reason === 'disputed') status = 'disputed';
    else if (j.reason === 'conflict') status = 'conflict';
    else {
      status = 'pending';
      reason = j.detail ?? j.reason ?? undefined;
    }
    const table = parsed.get(j.entry.id)?.table ?? tableOf(body) ?? { epoch: Number(body.epoch), rows: [], totals: {} };
    const published: PublishedRights = {
      id: j.entry.id,
      epoch: table.epoch,
      chainId: Math.floor(Number(body.chainId)),
      pot: normalizeAddress(body.pot) ?? String(body.pot ?? ''),
      root: String(body.root ?? ''),
      table,
      sources: [...(body.sources ?? [])],
      ...(body.memo ? { memo: String(body.memo) } : {}),
      createdAt: j.entry.created_at,
      pubkey: j.entry.pubkey,
      status,
      ...(reason ? { reason } : {}),
      attests: j.attests,
      disputes: j.disputes,
    };
    tables.push(published);
  }
  tables.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  for (const t of tables) if (t.status === 'committed') latest[potKey(t.chainId, t.pot)] = t;

  return { tables, accepted: result.accepted, latest, source: result.source, policy: result.policy };
}

/** The latest accepted table for a Pot, or null. */
export function latestRights(folded: FoldedRights | null | undefined, chainId: number, pot: string): PublishedRights | null {
  const key = normalizeAddress(pot);
  if (!folded || !key) return null;
  return folded.latest[potKey(Math.floor(Number(chainId)), key)] ?? null;
}

/** The published table whose entry id a Pot's `tableRef` names, if this reader has it. */
export function rightsByRef(folded: FoldedRights | null | undefined, tableRef: string): PublishedRights | null {
  const id = String(tableRef ?? '').replace(/^0x/, '').toLowerCase();
  return folded?.tables.find((t) => t.id.toLowerCase() === id) ?? null;
}

// ── From lens data to a folded statement ─────────────────────────────────

export interface RightsFromLensesInput extends LensContextInput {
  /** The `flow_rights` log (`getLog`). */
  entries: Iterable<LogEvent<unknown>>;
}

/** Fold the rights log with the signer set the lenses give — one function for every surface. */
export function foldRightsFromLenses(input: RightsFromLensesInput): { folded: FoldedRights; actors: AcceptedActors; policy: Policy } {
  const ctx = lensContext(input);
  const policy = ctx.policyFor(FLOW_RIGHTS_LENS);
  const folded = foldRights({ entries: input.entries, actors: ctx.actors, policy });
  return { folded, actors: ctx.actors, policy };
}
