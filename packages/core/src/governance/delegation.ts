// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Liquid democracy, half one: delegation.
 *
 * A member may hand their voting weight to another member; the delegate can
 * delegate onward, and the chain resolves transitively to whoever actually
 * voted. A direct vote always outranks one's own delegation, and a delegation
 * is revocable at any time — the whitepaper's fluid transition between direct
 * and delegative democracy.
 *
 * One record per delegator on the `delegations` lens, keyed by them, so
 * changing your delegate overwrites and revoking tombstones — the same
 * replicate-a-record-not-a-merge lesson as handoff confirmations.
 */

export const DELEGATIONS_LENS = 'delegations';
export const DELEGATION_TYPE = 'delegation';

export interface DelegationRecord {
  /** The delegator's user id — one outgoing delegation per member. */
  id: string;
  type: typeof DELEGATION_TYPE;
  from: string;
  to: string;
  /** ISO timestamp. */
  at: string;
  _deleted?: boolean;
}

/** from → to for every live (non-tombstoned) delegation. */
export type Delegations = Record<string, string>;

export function isDelegation(rec: unknown): rec is DelegationRecord {
  const r = rec as DelegationRecord | null;
  return Boolean(r && r.type === DELEGATION_TYPE && r.from && r.to);
}

export type BuildDelegationResult =
  | { ok: true; record: DelegationRecord }
  | { ok: false; reason: 'self' | 'invalid' };

export function buildDelegation(
  from: string | number,
  to: string | number,
  now: number = Date.now()
): BuildDelegationResult {
  const f = String(from ?? '');
  const t = String(to ?? '');
  if (!f || !t) return { ok: false, reason: 'invalid' };
  if (f === t) return { ok: false, reason: 'self' };
  return {
    ok: true,
    record: {
      id: f,
      type: DELEGATION_TYPE,
      from: f,
      to: t,
      at: new Date(now).toISOString(),
    },
  };
}

/**
 * Fold a lens's worth of records into the live from→to map. Tombstoned and
 * foreign-shaped records are ignored, so callers can pass the whole lens.
 */
export function foldDelegations(records: unknown[]): Delegations {
  const map: Delegations = {};
  for (const rec of records ?? []) {
    const r = rec as DelegationRecord | null;
    if (!r || r.type !== DELEGATION_TYPE || !r.from) continue;
    if (r._deleted || !r.to) delete map[String(r.from)];
    else map[String(r.from)] = String(r.to);
  }
  return map;
}

/**
 * Where a non-voter's weight lands: follow the delegation chain until it
 * reaches someone who voted (their vote carries the weight) or dead-ends.
 * Cycle-safe — a loop of delegates who none voted resolves to null.
 */
export function resolveDelegate(
  userId: string | number,
  delegations: Delegations,
  votes: ReadonlySet<string>
): string | null {
  const visited = new Set<string>();
  let cur = String(userId);
  while (delegations[cur] && !visited.has(cur)) {
    visited.add(cur);
    cur = delegations[cur];
    if (votes.has(cur)) return cur;
  }
  return null;
}

/** Minimal store surface for persisting a delegation record. */
export interface DelegationStoreLike {
  put(holonId: string, lens: string, value: unknown): Promise<unknown>;
}

/** Delegate `from`'s vote to `to` — overwrites any previous delegation. */
export async function setDelegate(
  db: DelegationStoreLike,
  holonId: string,
  from: string | number,
  to: string | number,
  now?: number
): Promise<BuildDelegationResult> {
  const built = buildDelegation(from, to, now);
  if (!built.ok) return built;
  await db.put(holonId, DELEGATIONS_LENS, built.record);
  return built;
}

/** Take the vote back — tombstone the delegator's record. */
export async function clearDelegate(
  db: DelegationStoreLike,
  holonId: string,
  from: string | number
): Promise<void> {
  const f = String(from ?? '');
  if (!f) return;
  await db.put(holonId, DELEGATIONS_LENS, {
    id: f,
    type: DELEGATION_TYPE,
    from: f,
    _deleted: true,
  });
}
