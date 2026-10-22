// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bootstrapActors } from '../protocol/membership.js';
import { signedEntry, testKey } from '../protocol/testing.js';
import { loadAllocationInputs } from './cascade-load.js';
import { claimHeadroom } from './ceiling.js';
import { loadClaimCeilings } from './ceiling-load.js';
import { buildClaim, foldClaims } from './claims.js';

// The olive collective again: the mother splits the harvest between two
// locations and the collectors; the collectors pass a third of theirs on to
// one picker. Mints are injected as the pot (the mints log needs signers).
const MOTHER = 'olive';
const LIMINAL = '-100';
const COLLECTORS = '-300';
const PICKER = 'pia';
const settings: Record<string, any> = {
  [MOTHER]: {
    name: 'Olive',
    allocation: { interiorPercent: 100, steepness: 50, nzones: 1, interiorMode: 'custom', shares: { [LIMINAL]: 1, [COLLECTORS]: 1 } },
  },
  [COLLECTORS]: {
    allocation: { interiorPercent: 100, steepness: 50, nzones: 1, interiorMode: 'custom', shares: { [COLLECTORS]: 2, [PICKER]: 1 } },
  },
};

function fakeHolosphere(mintsByHolon: Record<string, Record<string, number>> = {}) {
  return {
    async get(holon: string, lens: string, key: string) {
      return lens === 'settings' && key === holon ? (settings[holon] ?? null) : null;
    },
    async getAll(_holon: string, _lens: string) {
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
    mintsByHolon,
  };
}

const T0 = 1_760_000_000;
const holon = testKey();
const pia = testKey();
const partyOf = (pk: string) => (pk === pia.pk ? PICKER : null);
const actors = () => bootstrapActors({ members: [pia.pk], admins: [holon.pk], genesis: holon.pk });

describe('loadAllocationInputs', () => {
  it('reads one holon the way the boards read it, and says when nothing was stored', async () => {
    const hs = fakeHolosphere();
    const mother = await loadAllocationInputs(hs, MOTHER);
    expect(mother.configured).toBe(true);
    expect(mother.name).toBe('Olive');
    expect(mother.members.map((m) => [m.id, m.percentage])).toEqual([[LIMINAL, 1], [COLLECTORS, 1]]);
    const nobody = await loadAllocationInputs(hs, 'nobody');
    expect(nobody.configured).toBe(false);
    expect(nobody.members).toEqual([]);
    expect((await loadAllocationInputs(null, MOTHER)).configured).toBe(false);
  });
});

describe('loadClaimCeilings', () => {
  it('is empty for an unconfigured holon or a fund with nothing in it', async () => {
    const hs = fakeHolosphere();
    expect((await loadClaimCeilings(hs, 'nobody', { claims: null })).ceilings).toEqual({});
    expect((await loadClaimCeilings(hs, MOTHER, { claims: null })).ceilings).toEqual({});
  });

  it('follows the cascade: a picker reached only through the collectors gets a ceiling on the mother fund', async () => {
    const hs = fakeHolosphere();
    // 200 L in the mother's fund: the collective's balance stands in for a pot.
    const loaded = await loadClaimCeilings(hs, MOTHER, {
      claims: null,
      collective: { slug: 'x', name: 'x', currency: 'L', balance: 200, totalReceived: 200, totalSpent: 0, transactions: [], expenses: [], fetchedAt: 0 },
    });
    expect(loaded.pots).toEqual({ l: 200 });
    // Liminal keeps its 100; the collectors keep 2/3 of theirs, the picker 1/3.
    expect(loaded.ceilings).toEqual({ [LIMINAL]: { L: 100 }, [COLLECTORS]: { L: 66.67 }, [PICKER]: { L: 33.33 } });
    expect(loaded.truncated).toBe(false);

    // The fold under it: the picker's claim past a third is held.
    const over = signedEntry({ sk: pia.sk, item: buildClaim({ party: PICKER, amount: 40, unit: 'L', at: T0 * 1000 }).item as never, created_at: T0, lens: 'flow_claims' });
    const fine = signedEntry({ sk: pia.sk, item: buildClaim({ party: PICKER, amount: 30, unit: 'L', at: T0 * 1000 }).item as never, created_at: T0 + 1, lens: 'flow_claims' });
    const f = foldClaims({ entries: [over, fine], actors: actors(), partyOf, rights: loaded.ceilings });
    expect(f.claims.map((c) => c.status)).toEqual(['over', 'approved']);
    expect(claimHeadroom(loaded.ceilings, f, PICKER, 'L')).toBe(3.33);
  });
});
