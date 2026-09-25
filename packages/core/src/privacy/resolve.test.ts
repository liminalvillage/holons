// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { buildEvent } from 'holosphere/nostr-events.js';
import { createHoloSphere } from '../holosphere/factory.js';
import { testKey } from '../protocol/testing.js';
import { resolveGranteePubkey } from './resolve.js';

const APP = 'resolve-test';
const H = '-100';
const T0 = 1_760_000_000;

function sphere() {
  return createHoloSphere({ appName: APP, privateKey: testKey().sk, store: { adapter: 'memory' } });
}
const settingsEvent = (sk: Uint8Array, declared: string, at: number) =>
  buildEvent({ holon: H, lens: 'settings', item: { id: H, name: 'Group', holonPubkey: declared }, sk, created_at: at, extraTags: [['n', APP]] });

describe('resolveGranteePubkey', () => {
  it('a pubkey is its own grantee', async () => {
    const hs = sphere();
    const pub = testKey().pk;
    expect(await resolveGranteePubkey(hs, pub.toUpperCase())).toEqual({ pubkey: pub, via: 'pubkey' });
  });

  it('a founded holon resolves to its genesis', async () => {
    const hs = sphere();
    await hs.ready();
    await hs.foundHolon(H);
    expect(await resolveGranteePubkey(hs, H)).toEqual({ pubkey: hs.currentPubkey, via: 'anchor' });
  });

  it('an unfounded holon resolves to the earliest self-signed holonPubkey, not the last writer', async () => {
    const hs = sphere();
    await hs.ready();
    const bot = testKey();
    const squatter = testKey();
    hs.store.apply(settingsEvent(bot.sk, bot.pk, T0), { origin: 'remote' });
    hs.store.apply(settingsEvent(squatter.sk, squatter.pk, T0 + 5), { origin: 'remote' });
    expect((await hs.get(H, 'settings', H, null, { _skipAuthorize: true } as never)).holonPubkey).toBe(squatter.pk);
    expect(await resolveGranteePubkey(hs, H)).toEqual({ pubkey: bot.pk, via: 'anchor' });
  });

  it('a declaration signed by someone else, or nothing at all, is refused with a clear message', async () => {
    const hs = sphere();
    await hs.ready();
    await expect(resolveGranteePubkey(hs, H)).rejects.toThrow(/nothing signed says who speaks/);
    hs.store.apply(settingsEvent(testKey().sk, testKey().pk, T0), { origin: 'remote' });
    await expect(resolveGranteePubkey(hs, H)).rejects.toThrow(/nothing signed says who speaks/);
    await expect(resolveGranteePubkey(hs, '')).rejects.toThrow(/required/);
  });
});
