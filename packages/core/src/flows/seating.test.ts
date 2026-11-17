// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as nip19 from 'nostr-tools/nip19';
import { createHoloSphere } from '../holosphere/factory.js';
import { getFederationSnapshot } from '../federation/snapshot.js';
import { testKey } from '../protocol/testing.js';
import { linkSeatedHolons, seatableParty } from './seating.js';

const KEY = 'a'.repeat(64);

describe('seatableParty', () => {
  it('reads holon ids, keys and Telegram ids', () => {
    expect(seatableParty('holon_abcdefghijkmnpqr')).toEqual({ id: 'holon_abcdefghijkmnpqr', kind: 'holon' });
    expect(seatableParty('greenpill-garden')).toEqual({ id: 'greenpill-garden', kind: 'holon' });
    expect(seatableParty('-1001234567890')).toEqual({ id: '-1001234567890', kind: 'holon' });
    expect(seatableParty(' 235114395 ')).toEqual({ id: '235114395', kind: 'person' });
    expect(seatableParty(KEY.toUpperCase())).toEqual({ id: KEY, kind: 'person' });
    expect(seatableParty(nip19.npubEncode(KEY))).toEqual({ id: KEY, kind: 'person' });
  });

  it('reads a Flows link to a holon or a person', () => {
    expect(seatableParty('https://flows.example/h/holon_abcdefghijkmnpqr?view=x')).toEqual({ id: 'holon_abcdefghijkmnpqr', kind: 'holon' });
    expect(seatableParty('/p/235114395')).toEqual({ id: '235114395', kind: 'person' });
    expect(seatableParty('https://flows.example/h/fund%3Aclimate')).toEqual({ id: 'fund:climate', kind: 'holon' });
  });

  it('names nobody for empty text, words with spaces, or a broken npub', () => {
    expect(seatableParty('')).toBeNull();
    expect(seatableParty('two words')).toBeNull();
    expect(seatableParty('npub1notakey')).toBeNull();
    expect(seatableParty('x'.repeat(201))).toBeNull();
  });
});

describe('linkSeatedHolons', () => {
  it('links the holons the record does not name yet, once, and skips people and itself', async () => {
    const hs: any = createHoloSphere({ appName: 'seating-test', privateKey: testKey().sk, store: { adapter: 'memory' } });
    await hs.ready();
    const linked = await linkSeatedHolons(hs, 'holon_fund', ['holon_alder', '235114395', KEY, 'holon_fund', 'holon_alder'], { holon_alder: 'Alder' });
    expect(linked).toEqual(['holon_alder']);
    const snap = await getFederationSnapshot(hs, 'holon_fund');
    expect(snap.federated).toEqual(['holon_alder']);
    expect(snap.partnerNames.holon_alder).toBe('Alder');
    expect(await linkSeatedHolons(hs, 'holon_fund', ['holon_alder'])).toEqual([]);
  });
});
