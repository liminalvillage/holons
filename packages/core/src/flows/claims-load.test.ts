// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createHoloSphere } from '../holosphere/factory.js';
import { testKey } from '../protocol/testing.js';
import { setFederationPartner } from '../federation/partners.js';
import { buildClaim, buildPayout, FLOW_CLAIMS_LENS } from './claims.js';
import { buildMint, FLOW_MINTS_LENS } from './mints.js';
import { loadJudgedClaims, partyStandings } from './claims-load.js';
import { loadClaimCeilings } from './ceiling-load.js';
import { diamond, F1 } from './flow-graph.fixture.js';
import { indexFlowGraph } from './flow-graph-index.js';
import { graphRights } from './flow-graph-views.js';
import type { OpenCollectiveSnapshot } from './opencollective.js';

const APP = 'claims-load-test';
const T0 = 1_760_000_000;
const FUND = 'holon_cl_fund';
const collective = (balance: number): OpenCollectiveSnapshot => ({ slug: 'x', name: 'x', currency: 'EUR', balance, totalReceived: balance, totalSpent: 0, transactions: [], expenses: [], fetchedAt: 0 });

/** A founded fund whose key claims on a contributor's word, as the bot does. */
async function fund() {
  const me = testKey();
  const hs: any = createHoloSphere({ appName: APP, privateKey: me.sk, store: { adapter: 'memory' } });
  await hs.ready();
  await hs.foundHolon(FUND, { at: T0 });
  hs._readAuthority?.invalidate();
  await hs.put(FUND, 'settings', {
    id: FUND,
    holonPubkey: me.pk,
    allocation: { interiorPercent: 100, steepness: 50, nzones: 1, interiorMode: 'custom', shares: { ada: 1, other: 3 } },
  });
  return { hs, me };
}

describe('loadJudgedClaims', () => {
  it('reads the log, sizes the pot and judges each claim under its ceiling', async () => {
    const { hs } = await fund();
    const fine = buildClaim({ party: 'ada', amount: 60, unit: 'eur', rail: 'bank', onBehalfOf: 'ada' });
    const over = buildClaim({ party: 'ada', amount: 60, unit: 'eur', onBehalfOf: 'ada' });
    const first = await hs.append(FUND, FLOW_CLAIMS_LENS, fine.item, { refs: fine.refs, created_at: T0 + 10 });
    await hs.append(FUND, FLOW_CLAIMS_LENS, over.item, { refs: over.refs, created_at: T0 + 20 });

    // 400 in the collective, a quarter of it mine.
    const judged = await loadJudgedClaims(hs, FUND, { collective: collective(400) });
    expect(judged.pots).toEqual({ eur: 400 });
    expect(judged.ceilings.ada).toEqual({ EUR: 100 });
    expect(judged.ctx.folded.claims.map((c) => [c.amount, c.status, c.rail ?? null])).toEqual([[60, 'approved', 'bank'], [60, 'over', null]]);
    expect(partyStandings(judged, 'ada')).toEqual([
      { unit: 'EUR', headroom: 40, totals: { claimed: 60, settled: 0, pending: 0, over: 60, given: 0, received: 0 } },
    ]);

    const paid = buildPayout({ claimId: first.id, party: 'ada', amount: 60, unit: 'eur', rail: 'opencollective', ref: 'https://opencollective.com/x/expenses/9' });
    await hs.append(FUND, FLOW_CLAIMS_LENS, paid.item, { refs: paid.refs, created_at: T0 + 30 });
    // Paid, so the collective holds 60 less; the right is measured on what it ever held.
    const after = await loadJudgedClaims(hs, FUND, { collective: collective(340) });
    expect(partyStandings(after, 'ada')[0]).toMatchObject({ headroom: 40, totals: { claimed: 0, settled: 60 } });
    expect(after.ctx.folded.payouts[0]).toMatchObject({ rail: 'opencollective', ref: 'https://opencollective.com/x/expenses/9' });
  });

  it('has nothing to say about a party the fund does not know, or an empty fund', async () => {
    const { hs } = await fund();
    const judged = await loadJudgedClaims(hs, FUND);
    expect(judged.ceilings).toEqual({});
    expect(partyStandings(judged, 'ada')).toEqual([]);
    expect(partyStandings(await loadJudgedClaims(hs, FUND, { collective: collective(400) }), 'stranger')).toEqual([]);
  });
});

describe('loadClaimCeilings with known shares', () => {
  it('takes the map\'s rights and does not walk the cascade', async () => {
    const reads: string[] = [];
    const hs = {
      async get(holon: string, lens: string) {
        reads.push(`${holon}/${lens}`);
        return null;
      },
      async getAll() {
        return [];
      },
      async getLog() {
        return [];
      },
      async getAllGlobal() {
        return [];
      },
      async getFederation() {
        return { federated: [], partnerNames: {} };
      },
    };
    const shares = graphRights(indexFlowGraph(diamond()), F1);
    const loaded = await loadClaimCeilings(hs, F1, { claims: null, shares, collective: collective(200) });
    expect(loaded.ceilings).toEqual({ '111': { EUR: 150 }, 'artisan:9': { EUR: 50 } });
    expect(loaded.truncated).toBe(false);
    // No child's split was read: only the fund's own documents.
    expect(reads.every((r) => r.startsWith(`${F1}/`))).toBe(true);
  });
});

describe('loadClaimCeilings, own money only', () => {
  it('leaves out what reaches a holon from upstream, so a statement counts it once — where it is held', async () => {
    const hs: any = createHoloSphere({ appName: APP, privateKey: testKey().sk, store: { adapter: 'memory' } });
    await hs.ready();
    const MOTHER = 'holon_cl_mother';
    const CHILD = 'holon_cl_child';
    for (const h of [MOTHER, CHILD]) await hs.foundHolon(h, { at: T0 });
    hs._readAuthority?.invalidate();
    const custom = { interiorPercent: 100, steepness: 50, nzones: 1, interiorMode: 'custom' };
    await hs.put(MOTHER, 'settings', { id: MOTHER, allocation: { ...custom, shares: { [CHILD]: 1 } } });
    await hs.put(CHILD, 'settings', { id: CHILD, allocation: { ...custom, shares: { ada: 1 } } });
    await setFederationPartner(hs, MOTHER, CHILD, { inbound: [], outbound: [] });
    const mint = buildMint({ amount: 200, unit: 'L' });
    await hs.append(MOTHER, FLOW_MINTS_LENS, mint.item, { refs: mint.refs, created_at: T0 + 5 });

    // The mother holds it, and ada — at the end of the path — may claim it there.
    expect((await loadClaimCeilings(hs, MOTHER, { claims: null })).ceilings).toEqual({ ada: { L: 200 } });
    // The child's own board counts the same 200 as its to divide…
    expect((await loadClaimCeilings(hs, CHILD, { claims: null })).ceilings).toEqual({ ada: { L: 200 } });
    // …and a statement that already read the mother does not count it again.
    const own = await loadClaimCeilings(hs, CHILD, { claims: null, ownOnly: true });
    expect(own.pots).toEqual({});
    expect(own.ceilings).toEqual({});
  });
});
