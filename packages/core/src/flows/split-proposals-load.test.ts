// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createHoloSphere } from '../holosphere/factory.js';
import { getFederationSnapshot } from '../federation/snapshot.js';
import { addHolonMember } from '../protocol/founding.js';
import { signedEntry, testKey } from '../protocol/testing.js';
import { loadAllocationInputs } from './cascade-load.js';
import { saveAllocationConfig } from './settings.js';
import { FLOW_SPLIT_PROPOSALS_LENS, buildSplitVerdict } from './split-proposals.js';
import { applySplitProposal, decideSplitProposal, loadSplitProposals, proposeSplit } from './split-proposals-load.js';

const APP = 'split-proposals-load-test';
const T0 = 1_760_000_000;
const FUND = 'holon_fund';
const NEXT = { config: { interiorPercent: 30, steepness: 50, nzones: 2, resourced: 0 }, zones: { holon_alder: 1, holon_birch: 2 }, people: {} };

/** A fund founded by the instance's key, with `others` seated as admins too. */
async function fund(others: { pk: string }[] = []) {
  const hs: any = createHoloSphere({ appName: APP, privateKey: testKey().sk, store: { adapter: 'memory' } });
  await hs.ready();
  await hs.foundHolon(FUND, { at: T0 });
  for (const o of others) await addHolonMember(hs, FUND, o.pk, 'admin');
  hs._readAuthority?.invalidate();
  await saveAllocationConfig(hs, FUND, { interiorPercent: 50, steepness: 50, nzones: 2 }, { holon_alder: 1 });
  return hs;
}

/** Another admin's word, as it arrives from a relay. */
const arrive = (hs: any, sk: Uint8Array, id: string, verdict: 'attest' | 'dispute') => {
  const v = buildSplitVerdict(id, verdict);
  const e = signedEntry({ sk, item: v.item as never, refs: v.refs as never, created_at: Math.floor(Date.now() / 1000) + 1, holon: FUND, lens: FLOW_SPLIT_PROPOSALS_LENS, app: APP });
  hs.store.apply(e.event, { origin: 'remote' });
};

describe('split proposals', () => {
  it('applying links every holon it seats, so the new seats are read back', async () => {
    const hs = await fund();
    await proposeSplit(hs, FUND, { split: NEXT });
    expect((await getFederationSnapshot(hs, FUND)).federated).toEqual(expect.arrayContaining(['holon_alder', 'holon_birch']));
    const read = await loadAllocationInputs(hs, FUND);
    expect(read.zoned.filter((p) => p.zone >= 1).map((p) => p.id).sort()).toEqual(['holon_alder', 'holon_birch']);
  });

  it('a lone admin proposing applies the split at once, and the log says so', async () => {
    const hs = await fund();
    const { proposal } = await proposeSplit(hs, FUND, { split: NEXT, note: 'birch joins' });
    expect(proposal?.status).toBe('applied');
    const stored = await loadAllocationInputs(hs, FUND);
    expect(stored.zones).toEqual(NEXT.zones);
    expect(stored.config.interiorPercent).toBe(30);
    const ctx = await loadSplitProposals(hs, FUND);
    expect(ctx.admins).toBe(1);
    expect(ctx.open).toEqual([]);
  });

  it('with three admins it waits for a second yes, and the yes that passes it applies it', async () => {
    const b = testKey();
    const c = testKey();
    const hs = await fund([b, c]);
    const { id, proposal } = await proposeSplit(hs, FUND, { split: NEXT });
    expect(proposal).toMatchObject({ status: 'pending', needed: 2 });
    expect((await loadAllocationInputs(hs, FUND)).zones).toEqual({ holon_alder: 1 });
    arrive(hs, b.sk, id, 'attest');
    const ctx = await loadSplitProposals(hs, FUND);
    expect(ctx.proposals[0].status).toBe('passed');
    expect((await applySplitProposal(hs, FUND, id)).status).toBe('applied');
    expect((await loadAllocationInputs(hs, FUND)).zones).toEqual(NEXT.zones);
  });

  it('refuses to apply onto a split that moved since it was proposed', async () => {
    const b = testKey();
    const hs = await fund([b]);
    const { id } = await proposeSplit(hs, FUND, { split: NEXT });
    await saveAllocationConfig(hs, FUND, { interiorPercent: 60 });
    arrive(hs, b.sk, id, 'attest');
    const ctx = await loadSplitProposals(hs, FUND);
    expect(ctx.stale).toEqual([id]);
    await expect(applySplitProposal(hs, FUND, id)).rejects.toThrow(/changed/);
  });

  it('a no from enough admins rejects it, and nothing is written', async () => {
    const b = testKey();
    const hs = await fund([b]);
    const { id } = await proposeSplit(hs, FUND, { split: NEXT });
    arrive(hs, b.sk, id, 'dispute');
    expect((await loadSplitProposals(hs, FUND)).proposals[0].status).toBe('rejected');
    await expect(decideSplitProposal(hs, FUND, id, 'attest')).resolves.toMatchObject({ status: 'rejected' });
    expect((await loadAllocationInputs(hs, FUND)).zones).toEqual({ holon_alder: 1 });
  });
});
