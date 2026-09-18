// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Binding a member's share to an address — what to check before the wallet
 * is asked, and who is allowed to ask.
 *
 * On the guarded Bundle, `claim(userId, beneficiary)` binds a member id to an
 * address for good (until re-bound) and every later reward is pushed there.
 * Bound to a wallet, that is the end of the road. Bound to another Bundle, the
 * share is divided again on chain — the same cascade `cascade.ts` resolves
 * off-chain — so before offering that, a surface should say what lies below:
 * loops (the value rests at the revisited party instead of flowing on) and
 * how big the subtree is (every hop is gas in ONE transaction). A holon that
 * keeps part of what it gets is not flagged: the app's own sync seats the
 * holon itself for that part (`chainInteriorRoster`), so it is claimable.
 *
 * The contract enforces who may bind: the holon's owner wallet, or the wallet
 * the member is already bound to. `bindingAuthority` is that rule, so a
 * surface can say "not with this wallet" before the chain says "Not
 * authorized".
 */

import type { CascadeNode, CascadeResult } from './cascade.js';

export type BindingWarning = 'loop' | 'large' | 'deep';

export interface BindingPreflight {
  /** Loops that pass through the party, as paths from the root. */
  loops: string[][];
  /** Distinct holons in the party's subtree, the party included. */
  nodes: number;
  /** Hops below the party. */
  depth: number;
  warnings: BindingWarning[];
}

/** Above this many holons in one push, the gas of a single reward is a concern. */
export const LARGE_CASCADE_NODES = 12;
/** Above this many hops below the party, likewise. */
export const DEEP_CASCADE_HOPS = 2;

const same = (a: string, b: string) => String(a) === String(b);

/**
 * What binding `partyId` to a CONTRACT would set in motion, read off the
 * resolved cascade. Binding to a plain wallet has nothing below it, so the
 * result is empty then; callers pass `toContract: false` and get no warnings.
 *
 * The party may sit at several places in the tree (a seat on the interior
 * and one on a ring are one party; a diamond reaches it twice): every
 * occurrence directly under the root is walked, and the subtree measures are
 * the largest seen.
 */
export function bindingPreflight(
  cascade: CascadeResult | null | undefined,
  partyId: string,
  opts: { toContract: boolean } = { toContract: true },
): BindingPreflight {
  const empty: BindingPreflight = { loops: [], nodes: 0, depth: 0, warnings: [] };
  if (!cascade || !partyId || !opts.toContract) return empty;

  const seats = cascade.root.children.filter((c) => same(c.id, partyId));
  if (!seats.length) return empty;

  // A holon's own kept share is a leaf under it with the same id: not a hop,
  // not another holon.
  const holons = new Set<string>();
  let depth = 0;
  const walk = (node: CascadeNode, hops: number, parentId: string) => {
    const own = same(node.id, parentId);
    if (!own) {
      holons.add(node.id);
      if (hops > depth) depth = hops;
    }
    for (const child of node.children) walk(child, own ? hops : hops + 1, node.id);
  };
  for (const seat of seats) walk(seat, 0, '');
  const nodes = holons.size;

  const loops = cascade.cycles.filter((path) => path.some((id) => same(id, partyId)));

  const warnings: BindingWarning[] = [];
  if (loops.length) warnings.push('loop');
  if (nodes > LARGE_CASCADE_NODES) warnings.push('large');
  if (depth > DEEP_CASCADE_HOPS) warnings.push('deep');

  return { loops, nodes, depth, warnings };
}

export type BindingAuthority = 'owner' | 'bound' | 'none';

const ZERO = /^0x0{40}$/;
const normal = (a: string | null | undefined) => {
  const s = String(a ?? '').trim().toLowerCase();
  return s && /^0x[0-9a-f]{40}$/.test(s) && !ZERO.test(s) ? s : '';
};

/**
 * Whether `wallet` may bind a member on a Bundle, given the Bundle's owner and
 * the address the member is bound to today. The contract's rule, so the answer
 * here is the answer the chain would give.
 */
export function bindingAuthority(input: {
  wallet: string | null | undefined;
  owner: string | null | undefined;
  bound: string | null | undefined;
}): BindingAuthority {
  const wallet = normal(input.wallet);
  if (!wallet) return 'none';
  if (wallet === normal(input.owner)) return 'owner';
  if (wallet === normal(input.bound)) return 'bound';
  return 'none';
}

/** A binding as read from the contract: null when the member is unbound. */
export function readBoundAddress(raw: unknown): string | null {
  const a = normal(typeof raw === 'string' ? raw : '');
  return a || null;
}
