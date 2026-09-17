import { describe, expect, it } from 'vitest';
import {
  BUNDLE_BINDING_ABI,
  BUNDLE_CLAIM_ABI,
  BUNDLE_SYNC_ALL_ABI,
  WAD,
  bundleClaimArgs,
  chainInteriorRoster,
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

describe('chainInteriorRoster', () => {
  const members = [
    { userId: 'a', percentage: 60 },
    { userId: 'b', percentage: 40 },
  ];

  it('is the roster as given when anyone holds a share', () => {
    expect(chainInteriorRoster('h1', members, 50)).toEqual(members);
  });

  it('seats the holon itself when nobody does, so the interior pot is never stranded', () => {
    // The Bundle has no withdraw: an interior pot with no member is paid to
    // no balance at all. Under the holon's own id it stays claimable.
    expect(chainInteriorRoster('h1', [], 60)).toEqual([{ userId: 'h1', percentage: 100 }]);
    expect(chainInteriorRoster('h1', [{ userId: 'a', percentage: 0 }], 60)).toEqual([
      { userId: 'h1', percentage: 100 },
    ]);
    const { userIds, basisPoints } = sharesToBasisPoints(chainInteriorRoster('h1', [], 60));
    expect(userIds).toEqual(['h1']);
    expect(basisPoints).toEqual([10000n]);
  });

  it('leaves an empty roster alone when there is no interior pot to strand', () => {
    expect(chainInteriorRoster('h1', [], 0)).toEqual([]);
    expect(chainInteriorRoster('', [], 60)).toEqual([]);
  });
});

describe('bundleClaimArgs', () => {
  const address = '0x' + 'aB'.repeat(20);

  it('encodes the member id and the beneficiary positionally', () => {
    expect(bundleClaimArgs({ userId: 235114395 as unknown as string, beneficiary: address })).toEqual([
      '235114395',
      address,
    ]);
    expect(BUNDLE_CLAIM_ABI).toMatch(/^function claim\(string _userId, address _beneficiary\)/);
    expect(BUNDLE_BINDING_ABI).toHaveLength(2);
  });

  it('rejects an empty id and a zero or malformed address', () => {
    expect(() => bundleClaimArgs({ userId: '', beneficiary: address })).toThrow(/member/i);
    expect(() => bundleClaimArgs({ userId: 'u1', beneficiary: '0x' + '0'.repeat(40) })).toThrow(/address/i);
    expect(() => bundleClaimArgs({ userId: 'u1', beneficiary: '0x1234' })).toThrow(/address/i);
    expect(() => bundleClaimArgs({ userId: 'u1', beneficiary: 'vitalik.eth' })).toThrow(/address/i);
  });
});
