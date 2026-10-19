// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as nip19 from 'nostr-tools/nip19';
import { diamond, F1, F2, J, POT, seats } from './flow-graph.fixture.js';
import { indexFlowGraph, partiesByAddress, resolveParty, seatersOf } from './flow-graph-index.js';

const WALLET = '0xAbCdEf0000000000000000000000000000000001';
const KEY = 'b'.repeat(64);

const index = () =>
  indexFlowGraph(
    diamond(
      { [J]: seats({ '111': 2, '222': 1, [KEY]: 1 }, 'Project J') },
      {
        meta: {
          '111': { payout: WALLET },
          '222': { payout: WALLET.toLowerCase() },
          [J]: { aliases: { 'artisan:9': '222' } },
          [POT]: { aliases: { holon_imported: J } },
        },
      },
    ),
  );

describe('indexFlowGraph', () => {
  it('lists who seats a party, the largest way in first', () => {
    const seaters = seatersOf(index(), J);
    expect(seaters.map((s) => s.holon)).toEqual([POT, F1, F2]);
    expect(seaters[0]).toMatchObject({ via: 'interior', local: 50 });
    expect(seaters[0].share).toBeCloseTo(50);
    expect(seaters[1]).toMatchObject({ via: 'exterior', zone: 1 });
    expect(seatersOf(index(), POT)).toEqual([]);
    expect(seatersOf(index(), 'nobody')).toEqual([]);
  });

  it('finds the parties paid at an address, whatever its case', () => {
    expect(partiesByAddress(index(), WALLET.toUpperCase().replace('0X', '0x'))).toEqual(['111', '222']);
    expect(partiesByAddress(index(), '0x' + '0'.repeat(40))).toEqual([]);
  });

  it('knows a claim both ways', () => {
    const i = index();
    expect(i.aliasTo.get('artisan:9')).toBe('222');
    expect(i.aliasFrom.get('222')).toEqual(['artisan:9']);
    expect(i.aliasFrom.get(J)).toEqual(['holon_imported']);
  });

  it('resolves what someone pastes: an id, an npub, a claimed seat, an address', () => {
    const i = index();
    expect(resolveParty(i, ` ${J} `)).toEqual({ id: J, via: 'id' });
    expect(resolveParty(i, nip19.npubEncode(KEY))).toEqual({ id: KEY, via: 'id' });
    expect(resolveParty(i, 'holon_imported')).toEqual({ id: J, via: 'alias' });
    expect(resolveParty(i, 'artisan:9')).toEqual({ id: '222', via: 'alias' });
    expect(resolveParty(i, WALLET)).toEqual({ id: '111', via: 'address', others: ['222'] });
    expect(resolveParty(i, 'holon_unknown')).toBeNull();
    expect(resolveParty(i, '0x' + '0'.repeat(40))).toBeNull();
    expect(resolveParty(i, '')).toBeNull();
  });
});
