import { describe, expect, it } from 'vitest';
import {
  BUNDLE_SYNC_ALL_ABI,
  WAD,
  bundleSyncArgList,
  bundleSyncArgs,
  sharesToBasisPoints,
  steepnessFromContract,
  steepnessToContract,
} from './contract.js';

describe('steepness scale', () => {
  it('maps 0-100 onto the open WAD interval', () => {
    expect(steepnessToContract(50)).toBe(WAD / 2n);
    expect(steepnessToContract(0)).toBe(1n);
    expect(steepnessToContract(100)).toBe(WAD - 1n);
    expect(steepnessToContract(150)).toBe(WAD - 1n);
    expect(steepnessToContract(NaN)).toBe(WAD / 2n);
  });

  it('round-trips the UI value', () => {
    for (const v of [1, 25, 50, 73, 99]) {
      expect(steepnessFromContract(steepnessToContract(v))).toBe(v);
    }
  });
});

describe('sharesToBasisPoints', () => {
  it('sums to exactly 10000 with the last member absorbing the remainder', () => {
    const { userIds, basisPoints } = sharesToBasisPoints([
      { userId: 'a', percentage: 1 },
      { userId: 'b', percentage: 1 },
      { userId: 'c', percentage: 1 },
    ]);
    expect(userIds).toEqual(['a', 'b', 'c']);
    expect(basisPoints).toEqual([3333n, 3333n, 3334n]);
    expect(basisPoints.reduce((s, v) => s + v, 0n)).toBe(10000n);
  });

  it('matches the dashboard manager it replaces', () => {
    // The web's HolonsManager.syncAll computed: round(p/total*10000) for all
    // but the last, and 10000 - sum for the last. Pinned so the kiosk sends
    // what the dashboard always sent.
    const { basisPoints } = sharesToBasisPoints([
      { userId: 'a', percentage: 60 },
      { userId: 'b', percentage: 25.5 },
      { userId: 'c', percentage: 14.5 },
    ]);
    expect(basisPoints).toEqual([6000n, 2550n, 1450n]);
  });

  it('drops non-positive shares and handles nobody', () => {
    expect(sharesToBasisPoints([{ userId: 'a', percentage: 0 }])).toEqual({
      userIds: [],
      basisPoints: [],
    });
    expect(sharesToBasisPoints([])).toEqual({ userIds: [], basisPoints: [] });
    expect(
      sharesToBasisPoints([
        { userId: 'a', percentage: -3 },
        { userId: 'b', percentage: 4 },
      ]).userIds,
    ).toEqual(['b']);
  });
});

describe('bundleSyncArgs', () => {
  it('encodes the split, the roster and the placed partners', () => {
    const args = bundleSyncArgs({
      config: { interiorPercent: 60, steepness: 50, nzones: 3 },
      members: [
        { userId: 'a', percentage: 70 },
        { userId: 'b', percentage: 30 },
      ],
      partners: [
        { id: 'p1', zone: 2 },
        { id: 'p2', zone: 0 },
        { id: 'p3', zone: 1 },
      ],
    });
    expect(args.interiorBps).toBe(6000n);
    expect(args.exteriorBps).toBe(4000n);
    expect(args.steepness).toBe(WAD / 2n);
    expect(args.nzones).toBe(3n);
    expect(args.interiorUserIds).toEqual(['a', 'b']);
    expect(args.interiorPercentages).toEqual([7000n, 3000n]);
    expect(args.exteriorUserIds).toEqual(['p1', 'p3']);
    expect(args.exteriorZones).toEqual([2n, 1n]);
    expect(bundleSyncArgList(args)).toEqual([
      6000n,
      4000n,
      WAD / 2n,
      3n,
      ['a', 'b'],
      [7000n, 3000n],
      ['p1', 'p3'],
      [2n, 1n],
    ]);
  });

  it('keeps interior and exterior at 10000 together', () => {
    const args = bundleSyncArgs({
      config: { interiorPercent: 33.3, steepness: 10, nzones: 1 },
      members: [],
      partners: [],
    });
    expect(args.interiorBps + args.exteriorBps).toBe(10000n);
  });

  it('names the one function the surfaces call', () => {
    expect(BUNDLE_SYNC_ALL_ABI).toMatch(/^function syncAll\(/);
    expect(BUNDLE_SYNC_ALL_ABI.match(/,/g)?.length).toBe(7);
  });
});
