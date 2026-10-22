// SPDX-License-Identifier: AGPL-3.0-or-later
// Who reads for a holon: a personal holon's keys, a founded holon's log.
import { describe, expect, it } from 'vitest';
import { buildEvent } from 'holosphere/nostr-events.js';
import { createHoloSphere } from '../holosphere/factory.js';
import { testKey } from '../protocol/testing.js';
import { holonReaders } from './readers.js';

const APP = 'readers-test';
const H = '-100';
const T0 = 1_760_000_000;

function sphere(sk = testKey().sk) {
  return createHoloSphere({ appName: APP, privateKey: sk, store: { adapter: 'memory' } });
}

describe('holonReaders', () => {
  it('a personal holon reads through its key and the keys its own profile links', async () => {
    const me = testKey();
    const linked = testKey();
    const hs = sphere(me.sk);
    await hs.ready();
    expect(await holonReaders(hs, me.pk.toUpperCase())).toEqual({ keys: [me.pk], kind: 'personal' });
    await hs.put(me.pk, 'users', { id: me.pk, first_name: 'Ada', linkedKeys: [linked.pk] });
    expect((await holonReaders(hs, me.pk)).keys).toEqual([me.pk, linked.pk].sort());
    // A linked-keys claim signed by someone else does not count.
    const stranger = testKey();
    hs.store.apply(
      buildEvent({ holon: me.pk, lens: 'users', item: { id: me.pk, linkedKeys: [stranger.pk] }, sk: stranger.sk, created_at: T0 + 10, extraTags: [['n', APP]] }),
      { origin: 'remote' },
    );
    expect((await holonReaders(hs, me.pk)).keys).not.toContain(stranger.pk);
  });

  it('a founded holon reads through its genesis and every seated key', async () => {
    const hs = sphere();
    await hs.ready();
    const member = testKey();
    await hs.foundHolon(H);
    expect(await holonReaders(hs, H)).toEqual({ keys: [hs.currentPubkey], kind: 'group' });
    await hs.addMember(H, member.pk);
    expect((await holonReaders(hs, H)).keys).toEqual([hs.currentPubkey, member.pk].sort());
    await hs.removeMember(H, member.pk);
    expect((await holonReaders(hs, H)).keys).toEqual([hs.currentPubkey]);
  });

  it('a holon nothing signed speaks for has no readers — and that is not an error', async () => {
    const hs = sphere();
    await hs.ready();
    expect(await holonReaders(hs, H)).toEqual({ keys: [], kind: 'none' });
    expect(await holonReaders(hs, '')).toEqual({ keys: [], kind: 'none' });
    // A settings record declaring a holonPubkey counts only when that key signed it.
    const squatter = testKey();
    hs.store.apply(
      buildEvent({ holon: H, lens: 'settings', item: { id: H, holonPubkey: testKey().pk }, sk: squatter.sk, created_at: T0, extraTags: [['n', APP]] }),
      { origin: 'remote' },
    );
    expect(await holonReaders(hs, H)).toEqual({ keys: [], kind: 'none' });
    const bot = testKey();
    hs.store.apply(
      buildEvent({ holon: H, lens: 'settings', item: { id: H, holonPubkey: bot.pk }, sk: bot.sk, created_at: T0 + 1, extraTags: [['n', APP]] }),
      { origin: 'remote' },
    );
    expect(await holonReaders(hs, H)).toEqual({ keys: [bot.pk], kind: 'group' });
  });
});
