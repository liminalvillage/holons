// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { IdentityAttestation } from '../shifts/attestation.js';
import { createPartyResolver, partiesFromAttestations } from './identity.js';

const K = (c: string) => c.repeat(64);

describe('createPartyResolver', () => {
  it('binds by precedence and never remaps a bound key', () => {
    const r = createPartyResolver({
      keyToParty: [[K('a'), '7'], [K('b'), '8']],
      linkedKeys: [['7', [K('c'), K('B')]], ['9', [K('d')]]],
      holonPubkey: K('e'),
      holonId: '-100',
    });
    expect(r.partyOf(K('a'))).toBe('7');
    expect(r.partyOf(K('c'))).toBe('7');
    expect(r.partyOf(K('b'))).toBe('8'); // linked later under 7, but already bound to 8
    expect(r.partyOf(K('B'))).toBe('8'); // case-insensitive
    expect(r.partyOf(K('e'))).toBe('-100');
    expect(r.partyOf(K('f'))).toBeNull();
    expect(r.keysOf('7').sort()).toEqual([K('a'), K('c')]);
  });
});

describe('partiesFromAttestations', () => {
  it('turns telegram:<id> identifiers into the party id every domain uses', () => {
    const att = (over: Partial<IdentityAttestation>): IdentityAttestation => ({
      provider: K('9'), identifier: 'telegram:42', platform: 'telegram', platformId: '42',
      pubkeys: [K('a')], createdAt: 100, id: 'att1', ...over,
    });
    const parties = partiesFromAttestations([att({}), att({ identifier: 'telegram:43', pubkeys: [K('b')], id: 'att2' })]);
    expect(parties.get(K('a'))).toBe('42');
    expect(parties.get(K('b'))).toBe('43');
  });
});
