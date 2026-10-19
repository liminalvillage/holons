// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { loadPotRecord, readPotRecord, savePotRecord } from './pot-record.js';
import { claimCeilings } from './ceiling.js';
import { loadInboundRights } from './inbound.js';
import { loadPayoutAddresses, payoutAddressOf, readPayoutAddress, savePayoutAddress } from './payout.js';
import { hasPot, heldInPot, potTotal, potUnits } from './pot.js';
import { ZERO_ADDRESS, rightsRow } from './rights.js';
import { cutRights } from './rights-cut.js';
import type { AllocationResult } from './allocation.js';

// The olive collective: the grove's Pot holds the EVO vouchers; the grove
// splits between a location and the collectors, who pass a third on to a
// picker. The table flattens that to the picker's own row.
const GROVE = 'grove';
const LIMINAL = '-100';
const COLLECTORS = '-300';
const PICKER = 'pia';
const EVO = '0x' + 'e'.repeat(40);
const POT = '0x' + '9'.repeat(40);
const CHAIN = 11155111;

const wallets: Record<string, string> = { [LIMINAL]: '0x' + '1'.repeat(40), [PICKER]: '0x' + 'a'.repeat(40) };

const baseSettings = (): Record<string, any> => ({
  [GROVE]: {
    id: GROVE,
    name: 'Grove',
    pot: { address: POT, chainId: CHAIN, challenge: 259200 },
    allocation: { interiorPercent: 100, steepness: 50, nzones: 1, interiorMode: 'custom', shares: { [LIMINAL]: 1, [COLLECTORS]: 1 } },
  },
  [COLLECTORS]: {
    id: COLLECTORS,
    allocation: { interiorPercent: 100, steepness: 50, nzones: 1, interiorMode: 'custom', shares: { [COLLECTORS]: 2, [PICKER]: 1 } },
  },
  [LIMINAL]: { id: LIMINAL, payout: { address: wallets[LIMINAL] } },
  [PICKER]: { id: PICKER, payout: { address: wallets[PICKER] } },
});

function fakeHolosphere(settings: Record<string, any>, federation: Record<string, string[]> = {}) {
  const puts: Array<{ holon: string; lens: string; data: any }> = [];
  return {
    puts,
    async get(holon: string, lens: string, key: string) {
      return lens === 'settings' && key === holon ? (settings[holon] ?? null) : null;
    },
    async put(holon: string, lens: string, data: any) {
      puts.push({ holon, lens, data });
      if (lens === 'settings') settings[holon] = data;
    },
    async getAll() {
      return [];
    },
    async getLog() {
      return [];
    },
    async getFederation(holon: string) {
      return { federated: federation[holon] ?? [], partnerNames: {} };
    },
  };
}

describe('cutRights', () => {
  it('flattens the cascade into rows paid at each party\'s address and declares the receipts', async () => {
    const hs = fakeHolosphere(baseSettings());
    const cut = await cutRights(hs, GROVE, { previous: null, epoch: 84, chainId: CHAIN, received: { [EVO]: 900n } });
    expect(cut.complete).toBe(true);
    expect(cut.problems).toEqual([]);
    expect(cut.shares).toEqual({ [LIMINAL]: 50, [COLLECTORS]: expect.closeTo(33.33, 1), [PICKER]: expect.closeTo(16.67, 1) });
    expect(cut.table?.totals).toEqual({ [EVO]: 900n });
    expect(rightsRow(cut.table, LIMINAL, EVO)).toEqual({ party: LIMINAL, to: wallets[LIMINAL], token: EVO, cumulative: 450n });
    expect(rightsRow(cut.table, PICKER, EVO)).toEqual({ party: PICKER, to: wallets[PICKER], token: EVO, cumulative: 150n });
    // the collectors keep two thirds of theirs; no address yet, so they accrue
    expect(rightsRow(cut.table, COLLECTORS, EVO)).toEqual({ party: COLLECTORS, to: ZERO_ADDRESS, token: EVO, cumulative: 300n });
  });

  it('a holon with a Pot of its own is paid into it', async () => {
    const settings = baseSettings();
    settings[COLLECTORS].pot = { address: '0x' + '7'.repeat(40), chainId: CHAIN };
    const cut = await cutRights(fakeHolosphere(settings), GROVE, { previous: null, epoch: 84, chainId: CHAIN, received: { [EVO]: 900n } });
    expect(rightsRow(cut.table, COLLECTORS, EVO)?.to).toBe('0x' + '7'.repeat(40));
    // a Pot on another chain is not a payout address here
    settings[COLLECTORS].pot = { address: '0x' + '7'.repeat(40), chainId: 1 };
    const other = await cutRights(fakeHolosphere(settings), GROVE, { previous: null, epoch: 84, chainId: CHAIN, received: { [EVO]: 900n } });
    expect(rightsRow(other.table, COLLECTORS, EVO)?.to).toBe(ZERO_ADDRESS);
  });

  it('advances on the previous table and refuses to be signed when the walk was cut short', async () => {
    const hs = fakeHolosphere(baseSettings());
    const first = await cutRights(hs, GROVE, { previous: null, epoch: 84, chainId: CHAIN, received: { [EVO]: 900n } });
    const second = await cutRights(hs, GROVE, { previous: first.table, epoch: 85, chainId: CHAIN, received: { [EVO]: 1200n } });
    expect(second.complete).toBe(true);
    expect(rightsRow(second.table, PICKER, EVO)?.cumulative).toBe(200n);
    expect(second.table?.totals[EVO]).toBe(1200n);

    const short = await cutRights(hs, GROVE, { previous: first.table, epoch: 85, chainId: CHAIN, received: { [EVO]: 1200n }, maxHolons: 1 });
    expect(short.complete).toBe(false);
    expect(short.problems[0]).toMatch(/stopped at 1 holons/);
    // the table is still built, for the reviewer to see what it would have been
    expect(short.table).not.toBeNull();

    const stale = await cutRights(hs, GROVE, { previous: first.table, epoch: 84, chainId: CHAIN, received: { [EVO]: 1200n } });
    expect(stale.complete).toBe(false);
    expect(stale.problems[0]).toMatch(/not after/);
  });

  it('a holon with no allocation has no table', async () => {
    const cut = await cutRights(fakeHolosphere({}), GROVE, { previous: null, epoch: 84, chainId: CHAIN, received: {} });
    expect(cut).toMatchObject({ table: null, complete: false, problems: ['the holon has no allocation'] });
  });
});

describe('payout and Pot records', () => {
  it('reads a payout address, prefers a same-chain Pot, and writes through the settings document', async () => {
    expect(readPayoutAddress({ payout: { address: '0x' + 'A'.repeat(40) } })).toBe('0x' + 'a'.repeat(40));
    expect(readPayoutAddress({ payout: { address: 'nope' } })).toBeNull();
    expect(payoutAddressOf({ pot: { address: POT, chainId: CHAIN }, payout: { address: wallets[PICKER] } }, CHAIN)).toBe(POT);
    expect(payoutAddressOf({ pot: { address: POT, chainId: 1 }, payout: { address: wallets[PICKER] } }, CHAIN)).toBe(wallets[PICKER]);

    const settings: Record<string, any> = { [PICKER]: { id: PICKER, name: 'Pia' } };
    const hs = fakeHolosphere(settings);
    await savePayoutAddress(hs, PICKER, '0x' + 'B'.repeat(40));
    expect(settings[PICKER]).toEqual({ id: PICKER, name: 'Pia', payout: { address: '0x' + 'b'.repeat(40), setAt: expect.any(Number) } });
    await savePayoutAddress(hs, PICKER, null);
    expect(settings[PICKER]).toEqual({ id: PICKER, name: 'Pia' });
    await expect(savePayoutAddress(hs, PICKER, 'nope')).rejects.toThrow(/0x/);

    expect(await loadPayoutAddresses(hs, [PICKER, 'nobody', PICKER], CHAIN)).toEqual({ [PICKER]: null, nobody: null });
    await savePayoutAddress(hs, PICKER, wallets[PICKER]);
    expect(await loadPayoutAddresses(hs, [PICKER], CHAIN)).toEqual({ [PICKER]: wallets[PICKER] });
  });

  it('a Pot record needs an address and a chain, and merges onto the settings document', async () => {
    expect(readPotRecord({ pot: { address: POT, chainId: '11155111', challenge: 10, txHash: '0x1' } })).toEqual({ address: POT, chainId: CHAIN, challenge: 10, txHash: '0x1', tokens: [] });
    expect(readPotRecord({ pot: { address: POT } })).toBeNull();
    expect(readPotRecord({ bundle: { address: POT, chainId: CHAIN } })).toBeNull();
    const settings: Record<string, any> = { [GROVE]: { id: GROVE, name: 'Grove' } };
    const hs = fakeHolosphere(settings);
    await savePotRecord(hs, GROVE, { address: POT.toUpperCase().replace('0X', '0x'), chainId: CHAIN, deployedAt: 5, tokens: [] });
    expect(settings[GROVE]).toEqual({ id: GROVE, name: 'Grove', pot: { address: POT, chainId: CHAIN, deployedAt: 5, tokens: [] } });
    expect(await loadPotRecord(hs, GROVE)).toEqual({ address: POT, chainId: CHAIN, deployedAt: 5, tokens: [] });
    await expect(savePotRecord(hs, GROVE, { address: 'nope', chainId: CHAIN, tokens: [] })).rejects.toThrow(/0x/);
  });
});

describe('value held in a Pot is collected there, never claimed here', () => {
  it('an inbound right from a holon with a Pot is marked heldAt and left out of the claimable pot', async () => {
    const hs = fakeHolosphere(baseSettings(), { [COLLECTORS]: [GROVE], [GROVE]: [COLLECTORS, LIMINAL] });
    const got = await loadInboundRights(hs, COLLECTORS, { potsOf: async (id) => (id === GROVE ? [{ unit: 'EVO', total: 900 }] : []) });
    expect(got.inbound).toEqual([{ from: GROVE, unit: 'EVO', right: 450, percentage: 50, pot: 900, heldAt: { chainId: CHAIN, pot: POT } }]);
    const sources = { inbound: got.inbound };
    expect(potUnits(sources)).toEqual(['evo']);
    expect(hasPot('EVO', sources)).toBe(false);
    expect(potTotal('EVO', sources, null)).toBe(0);
  });

  it('a right held two levels up reaches the picker through the collectors, still held there', async () => {
    const hs = fakeHolosphere(baseSettings(), { [PICKER]: [COLLECTORS], [COLLECTORS]: [GROVE], [GROVE]: [COLLECTORS, LIMINAL] });
    const got = await loadInboundRights(hs, PICKER, { potsOf: async (id) => (id === GROVE ? [{ unit: 'EVO', total: 900 }] : []) });
    expect(got.inbound).toEqual([{ from: GROVE, unit: 'EVO', right: 150, percentage: expect.closeTo(16.67, 1), pot: 900, heldAt: { chainId: CHAIN, pot: POT } }]);
  });

  it('the Pot\'s receipts are the pot in that unit, and a claim in it has a zero ceiling', () => {
    const sources = { chain: { EVO: 900 }, mints: { byUnit: { EVO: 900, L: 50 } } as never };
    expect(heldInPot('evo', sources)).toBe(true);
    expect(heldInPot('L', sources)).toBe(false);
    expect(potUnits(sources)).toEqual(['evo', 'l']);
    expect(potTotal('EVO', sources, null)).toBe(900); // not 1800: the mint is the same lot
    expect(potTotal('L', sources, null)).toBe(50);

    const shares: AllocationResult = {
      config: { interiorPercent: 100, steepness: 50, nzones: 1 },
      unit: 'EVO',
      total: null,
      interior: [{ id: PICKER, label: 'Pia', percentage: 100, amount: null }],
      exterior: [],
    };
    const ceilings = claimCeilings({ shares, pots: { EVO: 900, L: 50 }, usage: null, claims: null, held: ['evo'] });
    expect(ceilings[PICKER]).toEqual({ EVO: 0, L: 50 });
  });
});

describe('cutRights with standing and a genesis lock', () => {
  const standingOf = (exited: string[], inNeed: string[] = []) => async () => ({
    exited: Object.fromEntries(exited.map((p) => [p, { id: 'x', epoch: 1, createdAt: 1 }])),
    inNeed: Object.fromEntries(inNeed.map((p) => [p, { id: 'y', epoch: 1, createdAt: 1 }])),
  });

  it('an exited party keeps its row and takes no new income; the others grow', async () => {
    const hs = fakeHolosphere(baseSettings());
    const first = await cutRights(hs, GROVE, { previous: null, epoch: 84, chainId: CHAIN, received: { [EVO]: 900n } });
    expect(rightsRow(first.table, LIMINAL, EVO)?.cumulative).toBe(450n);
    const second = await cutRights(hs, GROVE, {
      previous: first.table,
      epoch: 85,
      chainId: CHAIN,
      received: { [EVO]: 1200n },
      standingOf: standingOf([LIMINAL]),
    });
    expect(second.complete).toBe(true);
    expect(second.exited).toEqual([LIMINAL]);
    expect(second.shares[LIMINAL]).toBeUndefined();
    expect(rightsRow(second.table, LIMINAL, EVO)?.cumulative).toBe(450n);
    expect(rightsRow(second.table, COLLECTORS, EVO)?.cumulative).toBe(500n);
    expect(rightsRow(second.table, PICKER, EVO)?.cumulative).toBe(250n);
    expect(second.table?.totals[EVO]).toBe(1200n);
  });

  it('a seat unclaimed past the claim window is retired like an exit; a claimed or kept one stands', async () => {
    const settings = baseSettings();
    settings[GROVE].allocation.claimWindow = { until: 1000, keep: [COLLECTORS] };
    const hs = fakeHolosphere(settings);
    const open = await cutRights(hs, GROVE, { previous: null, epoch: 84, chainId: CHAIN, received: { [EVO]: 900n }, now: 999 });
    expect(open.lapsed).toEqual([]);
    expect(rightsRow(open.table, LIMINAL, EVO)?.cumulative).toBe(450n);

    const closed = await cutRights(hs, GROVE, { previous: open.table, epoch: 85, chainId: CHAIN, received: { [EVO]: 1200n }, now: 1000 });
    expect(closed.complete).toBe(true);
    expect(closed.lapsed).toEqual([LIMINAL]);
    expect(closed.shares[LIMINAL]).toBeUndefined();
    expect(rightsRow(closed.table, LIMINAL, EVO)?.cumulative).toBe(450n);
    expect(rightsRow(closed.table, COLLECTORS, EVO)?.cumulative).toBe(500n);

    // claimed in time: the alias carries the seat past the window
    settings[GROVE].allocation.aliases = { [LIMINAL]: PICKER };
    const claimed = await cutRights(fakeHolosphere(settings), GROVE, { previous: null, epoch: 85, chainId: CHAIN, received: { [EVO]: 900n }, now: 5000 });
    expect(claimed.lapsed).toEqual([]);
    expect(claimed.shares[PICKER]).toBeCloseTo(50 + 100 / 6, 1);
  });

  it('a needs bucket pays whoever is flagged; a locked split that moved is not signed', async () => {
    const settings = baseSettings();
    settings[GROVE].allocation = {
      interiorPercent: 100,
      steepness: 50,
      nzones: 0,
      interiorMode: 'custom',
      buckets: [
        { id: 'legacy', percent: 50, mode: 'custom', shares: { [LIMINAL]: 1 } },
        { id: 'needs', percent: 50, mode: 'needs' },
      ],
    };
    const hs = fakeHolosphere(settings);
    const cut = await cutRights(hs, GROVE, { previous: null, epoch: 84, chainId: CHAIN, received: { [EVO]: 1000n }, standingOf: standingOf([], [PICKER]) });
    expect(cut.complete).toBe(true);
    expect(cut.shares).toEqual({ [LIMINAL]: 50, [PICKER]: 50 });
    expect(rightsRow(cut.table, PICKER, EVO)?.cumulative).toBe(500n);

    settings[GROVE].allocation.genesis = { hash: 'f'.repeat(64), at: 1 };
    const moved = await cutRights(fakeHolosphere(settings), GROVE, { previous: null, epoch: 84, chainId: CHAIN, received: { [EVO]: 1000n } });
    expect(moved.complete).toBe(false);
    expect(moved.problems).toEqual(['the split differs from genesis']);
    expect(moved.table).not.toBeNull();
  });
});

describe('cutRights over a wide graph', () => {
  it('gives the tree room for every holon the walk may read, and refuses when it is cut short', async () => {
    // 60 projects that each pass on to 10 people: 660 nodes, past the default 500
    const fund: Record<string, number> = {};
    const docs: Record<string, any> = {};
    for (let i = 0; i < 60; i++) {
      fund[`proj${i}`] = 1;
      const people: Record<string, number> = {};
      for (let j = 0; j < 10; j++) people[`u${i}_${j}`] = 1;
      docs[`proj${i}`] = { id: `proj${i}`, allocation: { interiorPercent: 100, nzones: 0, interiorMode: 'custom', shares: people } };
    }
    docs[GROVE] = { id: GROVE, allocation: { interiorPercent: 100, nzones: 0, interiorMode: 'custom', shares: fund } };
    const opts = { previous: null, epoch: 84, chainId: CHAIN, received: { [EVO]: 600n }, maxHolons: 700 }; // every party is read once: 60 projects + 600 people
    const tight = await cutRights(fakeHolosphere(docs), GROVE, { ...opts, maxNodes: 500 });
    expect(tight.complete).toBe(false);
    expect(tight.problems).toContain('the cascade reached its depth or node bound');
    const roomy = await cutRights(fakeHolosphere(docs), GROVE, opts);
    expect(roomy.complete).toBe(true);
    expect(roomy.table?.rows).toHaveLength(600);
  });
});
