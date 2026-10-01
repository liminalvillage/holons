// SPDX-License-Identifier: AGPL-3.0-or-later
// The privacy verbs on a real local-only instance built by the core factory —
// the way every UI gets one. No relays: grants are recorded, not delivered.
import { describe, expect, it } from 'vitest';
import { createHoloSphere } from '../holosphere/factory.js';
import { testKey } from '../protocol/testing.js';
import { audience, isLocked, lock, privacyOfHolon, share, sync, unlock, unshare } from './audience.js';

const APP = 'audience-test';
const H = '-100777';

function fresh(sk = testKey().sk) {
  return createHoloSphere({ appName: APP, privateKey: sk, store: { adapter: 'memory' } });
}

describe('privacy verbs', () => {
  it('lock seals a lens with the owner holon as its audience; unlock opens it again', async () => {
    const hs = fresh();
    await hs.ready();
    await hs.foundHolon(H);
    const a = await lock(hs, { holon: H, lens: 'quests' });
    await hs.put(H, 'quests', { id: 'q1', title: 'hidden', status: 'ongoing', initiator: { id: 7, username: 'ada' }, participants: [] });
    expect(a).toEqual({
      scope: { holon: H, lens: 'quests' },
      locked: true,
      owned: true,
      holons: [{ holon: H, kind: 'group', self: true, readers: 1, status: 'synced' }],
    });
    expect(hs.store.getEvents(H, 'quests', 'q1')[0].content).not.toContain('hidden');
    expect(await hs.getAll(H, 'quests')).toEqual([expect.objectContaining({ id: 'q1', title: 'hidden' })]);
    expect(hs.store.list(H, 'rea_events')).toEqual([]);   // sealed quest → no plaintext ledger
    expect(await privacyOfHolon(hs, H)).toEqual({ quests: { locked: true, items: [] } });
    expect(await isLocked(hs, { holon: H, lens: 'quests', item: 'q1' })).toBe(true);

    const u = await unlock(hs, { holon: H, lens: 'quests' });
    expect(u).toMatchObject({ locked: false, owned: false, holons: [] });
    expect(hs.store.getEvents(H, 'quests', 'q1')[0].content).toContain('hidden');
    expect(await privacyOfHolon(hs, H)).toEqual({});
  });

  it('a card locks on its own in a public lens, never under a locked lens', async () => {
    const hs = fresh();
    await hs.ready();
    await hs.foundHolon(H);
    await hs.put(H, 'quests', { id: 'q1', title: 'open' });
    await hs.put(H, 'quests', { id: 'q2', title: 'hush' });
    await lock(hs, { holon: H, lens: 'quests', item: 'q2' });
    expect(await privacyOfHolon(hs, H)).toEqual({ quests: { locked: false, items: ['q2'] } });
    expect(hs.store.getEvents(H, 'quests', 'q1')[0].content).toContain('open');
    expect(hs.store.getEvents(H, 'quests', 'q2')[0].content).not.toContain('hush');
    await lock(hs, { holon: H, lens: 'quests' });
    await expect(lock(hs, { holon: H, lens: 'quests', item: 'q1' })).rejects.toThrow(/locked as a whole/);
    expect(await privacyOfHolon(hs, H)).toEqual({ quests: { locked: true, items: [] } });
  });

  it('refuses lenses that cannot be private', async () => {
    const hs = fresh();
    await expect(lock(hs, { holon: H, lens: 'settings' })).rejects.toThrow(/cannot be private/);
    await expect(lock(hs, { holon: H, lens: '_policy' })).rejects.toThrow(/append-only/);
  });

  it('share adds a holon and hands its readers the key; unshare rotates and forgets them', async () => {
    const hs = fresh();
    await hs.ready();
    await hs.foundHolon(H);
    const friend = testKey();
    await hs.put(H, 'quests', { id: 'q1', title: 'hidden' });
    await lock(hs, { holon: H, lens: 'quests' });

    // A personal holon: its readers are its key. No relays here, so the DM
    // does not leave — the grant stays pending and is retried by sync.
    const shared = await share(hs, { holon: H, lens: 'quests' }, friend.pk);
    expect(shared.holons.map((h) => [h.holon, h.kind, h.self, h.readers, h.status])).toEqual([
      [H, 'group', true, 1, 'synced'],
      [friend.pk, 'personal', false, 1, 'pending'],
    ]);
    expect(await hs.privacy.sentGet({ holon: H, lens: 'quests' })).toEqual({});
    // The audience never exposes a key, only counts and ids.
    expect(JSON.stringify(shared)).not.toMatch(/"key"|kid/);

    // A group holon nothing signed speaks for: listed, with no readers yet.
    const again = await share(hs, { holon: H, lens: 'quests' }, '-200');
    expect(again.holons.find((h) => h.holon === '-200')).toMatchObject({ kind: 'group', readers: 0, status: 'no-readers' });
    expect(await hs.privacy.audienceGet({ holon: H, lens: 'quests' })).toEqual([['group', H], ['p', friend.pk], ['group', '-200']]);
    // Sharing twice is one entry.
    await share(hs, { holon: H, lens: 'quests' }, '-200');
    expect((await hs.privacy.audienceGet({ holon: H, lens: 'quests' }))!.length).toBe(3);

    // Nothing reached the friend (no relay), so taking it back rotates nothing.
    const before = hs.store.getEvents(H, 'quests', 'q1')[0];
    const after = await unshare(hs, { holon: H, lens: 'quests' }, friend.pk);
    expect(after.holons.map((h) => h.holon)).toEqual([H, '-200']);
    expect(hs.store.getEvents(H, 'quests', 'q1')[0].content).toBe(before.content);
    // A reader that did hold the key loses it: the scope is rewritten under a new key.
    await hs.privacy.sentSet({ holon: H, lens: 'quests' }, { [friend.pk]: 'deadbeefdeadbeef' });
    await share(hs, { holon: H, lens: 'quests' }, friend.pk);
    const held = hs.store.getEvents(H, 'quests', 'q1')[0];
    await unshare(hs, { holon: H, lens: 'quests' }, friend.pk);
    expect(hs.store.getEvents(H, 'quests', 'q1')[0].content).not.toBe(held.content);
    expect(await hs.privacy.sentGet({ holon: H, lens: 'quests' })).toEqual({});

    await expect(share(hs, { holon: H, lens: 'quests' }, H)).rejects.toThrow(/always reads its own/);
    await expect(unshare(hs, { holon: H, lens: 'quests' }, H)).rejects.toThrow(/cannot be removed/);
    await expect(share(hs, { holon: H, lens: 'roles' }, friend.pk)).rejects.toThrow(/lock it first/);
  });

  it('a new member of the owner holon gets every key on sync; nobody else can read the audience', async () => {
    const owner = testKey();
    const member = testKey();
    const hs = fresh(owner.sk);
    await hs.ready();
    await hs.foundHolon(H);
    await hs.put(H, 'quests', { id: 'q1', title: 'hidden' });
    await lock(hs, { holon: H, lens: 'quests', item: 'q1' });
    await hs.addMember(H, member.pk);
    const reports = await sync(hs, H);
    expect(Object.keys(reports)).toEqual(['quests/q1']);
    // Without a relay the DM cannot leave; the member is reported pending, not forgotten.
    expect(reports['quests/q1']).toEqual({ granted: [], revoked: [], pending: [member.pk] });
    expect((await audience(hs, { holon: H, lens: 'quests', item: 'q1' })).holons[0]).toMatchObject({ holon: H, readers: 2, status: 'pending' });

    // The member's own device: the card is private, the audience is not theirs to see.
    await hs.login(member.sk);
    const view = await audience(hs, { holon: H, lens: 'quests', item: 'q1' });
    expect(view).toEqual({ scope: { holon: H, lens: 'quests', item: 'q1' }, locked: true, owned: false, holons: [] });
    expect(await sync(hs, H)).toEqual({});
  });
});
