// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { IdentityAttestation } from '../shifts/attestation.js';
import { bootstrapFromLenses } from './bootstrap.js';
import { createPartyResolver } from './identity.js';
import { bootstrapActors } from './membership.js';

const K = (c: string) => c.repeat(64);

describe('bootstrapFromLenses', () => {
  const att = (identifier: string, pubkeys: string[], id: string): IdentityAttestation => ({
    provider: K('9'), identifier, platform: 'telegram', platformId: identifier.slice(9), pubkeys, createdAt: 100, id,
  });

  it('assembles members, admins and the party map from settings, users and attestations', () => {
    const b = bootstrapFromLenses({
      holonId: '-100',
      settings: { holonPubkey: K('e'), admin: '7', nostrTrustedPubkeys: [K('f'), 'junk'] },
      users: [{ id: 7, linkedKeys: [K('c')] }, { id: 8 }, null],
      attestations: [att('telegram:7', [K('a')], 'a1'), att('telegram:8', [K('b')], 'a2')],
    });
    expect(b.holonPubkey).toBe(K('e'));
    expect(new Set(b.actors.members)).toEqual(new Set([K('a'), K('b'), K('c'), K('e'), K('f')]));
    expect(new Set(b.actors.admins)).toEqual(new Set([K('e'), K('a'), K('c')]));
    expect(b.actors.genesis).toBe(K('e'));

    const actors = bootstrapActors(b.actors);
    expect(actors.roleAt(K('a'), 0)).toBe('admin');
    expect(actors.roleAt(K('b'), 0)).toBe('member');
    expect(actors.roleAt(K('f'), 0)).toBe('member');

    const parties = createPartyResolver({ keyToParty: b.keyToParty, linkedKeys: b.linkedKeys, holonPubkey: b.holonPubkey, holonId: '-100' });
    expect(parties.partyOf(K('a'))).toBe('7');
    expect(parties.partyOf(K('c'))).toBe('7');
    expect(parties.partyOf(K('b'))).toBe('8');
    expect(parties.partyOf(K('e'))).toBe('-100');
    expect(parties.partyOf(K('f'))).toBeNull(); // trusted to write, but nobody's party
  });

  it('is empty but well-formed with nothing to go on', () => {
    const b = bootstrapFromLenses({ holonId: 'x' });
    expect(b.actors).toEqual({ members: [], admins: [], genesis: null });
    expect(b.holonPubkey).toBeNull();
  });
});
