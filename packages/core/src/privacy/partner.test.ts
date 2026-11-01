// SPDX-License-Identifier: AGPL-3.0-or-later
// Federating with a partner: which locked lenses it cannot open yet, and sharing them.
import { describe, expect, it } from 'vitest';
import { createHoloSphere } from '../holosphere/factory.js';
import { testKey } from '../protocol/testing.js';
import { lock } from './audience.js';
import { lensesToShare, shareWithPartner, unsharedOutbound } from './partner.js';
import type { Audience } from './types.js';

const APP = 'partner-share-test';
const H = '-100888';
const P = '-100999';

const aud = (lens: string, holons: string[], over: Partial<Audience> = {}): Audience => ({
  scope: { holon: H, lens },
  locked: true,
  owned: true,
  canManage: true,
  holons: holons.map((holon) => ({
    holon,
    kind: 'group',
    self: holon === H,
    readers: 1,
    status: 'synced',
  })),
  ...over,
});

describe('lensesToShare', () => {
  it('offers the locked lenses it owns that flow out and the partner cannot open', () => {
    const auds = {
      quests: aud('quests', [H]),
      library: aud('library', [H, P]),
      roles: aud('roles', [H], { owned: false, holons: [] }),
      events: aud('events', [H], { locked: false }),
    };
    expect(lensesToShare(auds, P, ['quests', 'library', 'roles', 'events', 'offers', 'quests'])).toEqual(['quests']);
    expect(lensesToShare(auds, P, [])).toEqual([]);
    expect(lensesToShare(auds, '', ['quests'])).toEqual([]);
  });
});

describe('unsharedOutbound / shareWithPartner', () => {
  it('reads the vaults, then shares the lens so it drops off the offer', async () => {
    const hs = createHoloSphere({
      appName: APP,
      privateKey: testKey().sk,
      store: { adapter: 'memory' },
    });
    await hs.ready();
    await hs.foundHolon(H);
    await lock(hs, { holon: H, lens: 'quests' });

    expect(await unsharedOutbound(hs, H, P, ['quests', 'library'])).toEqual(['quests']);
    expect(await unsharedOutbound(hs, H, P, ['library'])).toEqual([]);

    const shared = await shareWithPartner(hs, H, P, ['quests']);
    expect(shared.quests.holons.map((h) => h.holon)).toEqual([H, P]);
    expect(await unsharedOutbound(hs, H, P, ['quests', 'library'])).toEqual([]);
  });
});
