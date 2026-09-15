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
