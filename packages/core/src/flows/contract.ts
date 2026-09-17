// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Bundle contract's `syncAll` call, encoded in one place.
 *
 * Two surfaces push the allocation split on-chain — the dashboard through its
 * contract manager, the kiosk through a bare wallet call — and the chain must
 * be handed the same numbers whichever one sent them. So the arithmetic that
 * turns the UI's percentages into what the contract stores lives here, pure
 * and pinned by `contract.test.ts`:
 *
 *   - the interior/exterior split in BASIS POINTS (sum 10000)
 *   - steepness on the WAD scale, strictly inside (0, 1e18)
 *   - member shares in basis points that sum to EXACTLY 10000, the last
 *     member absorbing the rounding remainder
 *   - only placed partners (zone ≥ 1), with their ring
 *
 * No ethers here (rule 2): the result is plain strings, numbers and bigints
 * that any web3 library can pass straight through.
 */

import type { AllocationConfig } from './allocation.js';

/** One WAD: the contract's fixed-point unit. */
export const WAD = 10n ** 18n;

/** The only Bundle function these surfaces call, as a human-readable ABI. */
export const BUNDLE_SYNC_ALL_ABI =
  'function syncAll(uint256 _interior, uint256 _exterior, uint256 _steepness, uint256 _nzones, string[] _interiorUserIds, uint256[] _interiorPercentages, string[] _exteriorUserIds, uint256[] _exteriorZones)';

/** Convert steepness from the UI value (0-100) to the contract value (WAD). */
export function steepnessToContract(uiValue: number): bigint {
  // The contract expects 0 < s < 1e18: clamp to [1, 1e18 - 1].
  const minValue = 1n;
  const maxValue = WAD - 1n;
  const clamped = Number.isFinite(uiValue) ? Math.min(100, Math.max(0, uiValue)) : 50;
  const scaled = BigInt(Math.floor((clamped / 100) * 1e18));
  if (scaled <= 0n) return minValue;
  if (scaled >= WAD) return maxValue;
  return scaled;
}

/** Convert steepness from the contract value (WAD) to the UI value (0-100). */
export function steepnessFromContract(contractValue: bigint): number {
  return Number((contractValue * 100n) / WAD);
}

/** An interior member's share, 0-100, as the resolver yields it. */
export interface BundleMember {
  userId: string;
  percentage: number;
}

/** A partner's ring; zone < 1 means unplaced and is not sent. */
export interface BundlePartner {
  id: string;
  zone: number;
}

/** The positional arguments of `syncAll`, in order. */
export interface BundleSyncArgs {
  interiorBps: bigint;
  exteriorBps: bigint;
  steepness: bigint;
  nzones: bigint;
  interiorUserIds: string[];
  /** Basis points, summing to exactly 10000 when anyone is in. */
  interiorPercentages: bigint[];
  exteriorUserIds: string[];
  exteriorZones: bigint[];
}

/**
 * Member shares in basis points summing to exactly 10000.
 *
 * Non-positive shares are dropped first; the rest are normalized against
 * their own sum and rounded, and the last member takes whatever the rounding
 * left over so the contract's sum check passes.
 */
export function sharesToBasisPoints(members: BundleMember[]): {
  userIds: string[];
  basisPoints: bigint[];
} {
  const valid = (members ?? []).filter(
    (m) => Number.isFinite(m.percentage) && m.percentage > 0 && String(m.userId ?? ''),
  );
  const total = valid.reduce((s, m) => s + m.percentage, 0);
  if (valid.length === 0 || total <= 0) return { userIds: [], basisPoints: [] };

  const rounded = valid.map((m) => Math.round((m.percentage / total) * 10000));
  const sumButLast = rounded.slice(0, -1).reduce((s, v) => s + v, 0);
  rounded[rounded.length - 1] = 10000 - sumButLast;

  return {
    userIds: valid.map((m) => String(m.userId)),
    basisPoints: rounded.map((v) => BigInt(v)),
  };
}

/** Encode a split, its interior roster and its placed partners for `syncAll`. */
export function bundleSyncArgs(input: {
  config: Pick<AllocationConfig, 'interiorPercent' | 'steepness' | 'nzones'>;
  members: BundleMember[];
  partners: BundlePartner[];
}): BundleSyncArgs {
  const interior = Math.round(
    Math.min(100, Math.max(0, Number(input.config.interiorPercent) || 0)),
  );
  const { userIds, basisPoints } = sharesToBasisPoints(input.members);
  const placed = (input.partners ?? []).filter(
    (p) => Number.isFinite(p.zone) && p.zone >= 1 && String(p.id ?? ''),
  );
  return {
    interiorBps: BigInt(interior * 100),
    exteriorBps: BigInt((100 - interior) * 100),
    steepness: steepnessToContract(input.config.steepness),
    nzones: BigInt(Math.max(0, Math.floor(Number(input.config.nzones) || 0))),
    interiorUserIds: userIds,
    interiorPercentages: basisPoints,
    exteriorUserIds: placed.map((p) => String(p.id)),
    exteriorZones: placed.map((p) => BigInt(Math.floor(p.zone))),
  };
}

/** The same args as the positional list ethers' `contract.syncAll(...)` takes. */
export function bundleSyncArgList(args: BundleSyncArgs): unknown[] {
  return [
    args.interiorBps,
    args.exteriorBps,
    args.steepness,
    args.nzones,
    args.interiorUserIds,
    args.interiorPercentages,
    args.exteriorUserIds,
    args.exteriorZones,
  ];
}

/**
 * The interior roster to send on-chain.
 *
 * The Bundle has no withdraw. An interior pot with no member is not paid to
 * anyone's balance — it simply stays in the contract, unaccounted. That is
 * exactly the roster a personal holon has (its owner is not scored as a member
 * of themselves), so a holon with an interior share and nobody in it seats
 * ITSELF: the pot then accrues under the holon's own id, where it can be
 * claimed. With no interior pot there is nothing to strand and an empty
 * roster is left alone.
 */
export function chainInteriorRoster(
  holonId: string,
  members: BundleMember[],
  interiorPercent: number,
): BundleMember[] {
  const roster = members ?? [];
  const anyone = roster.some((m) => Number.isFinite(m.percentage) && m.percentage > 0 && String(m.userId ?? ''));
  const id = String(holonId ?? '');
  if (anyone || !id || !(Number(interiorPercent) > 0)) return roster;
  return [{ userId: id, percentage: 100 }];
}

/**
 * `claim` binds a member's id to an address: from then on the Bundle pushes
 * their share there, and when the address is another Bundle that one divides
 * it again — the on-chain cascade (`cascade.ts` is its mirror).
 *
 * Encoders only. No surface calls `claim` yet, deliberately: on the deployed
 * Bundle it is open to ANY caller and cannot be undone, so whoever calls
 * first binds a member's share for good. The binding UI waits for a Bundle
 * that gates it.
 */
export const BUNDLE_CLAIM_ABI = 'function claim(string _userId, address _beneficiary)';

/** Read-only views of a member's binding. */
export const BUNDLE_BINDING_ABI = [
  'function userIdToAddress(string) view returns (address)',
  'function hasClaimed(string) view returns (bool)',
] as const;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = /^0x0{40}$/;

/** The positional arguments of `claim`, validated before any wallet sees them. */
export function bundleClaimArgs(input: { userId: string; beneficiary: string }): [string, string] {
  const userId = String(input.userId ?? '').trim();
  if (!userId) throw new Error('A member id is required to claim');
  const beneficiary = String(input.beneficiary ?? '').trim();
  if (!ADDRESS.test(beneficiary) || ZERO_ADDRESS.test(beneficiary)) {
    throw new Error('The beneficiary must be a non-zero 0x address');
  }
  return [userId, beneficiary];
}
