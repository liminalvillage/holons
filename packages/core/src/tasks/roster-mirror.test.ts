// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The mirror behind holosphere.put, on a real local-only instance built by the
// core factory — the way every UI gets one.
import { describe, expect, it, vi } from 'vitest';
import { createHoloSphere } from '../holosphere/factory.js';
import { testKey } from '../protocol/testing.js';
import { addHost } from './hosts.js';
import { addParticipant, removeParticipant, setParticipants } from './participants.js';
import { attachRosterMirror, hasRosterMirror, rosterOf } from './roster-mirror.js';
import type { Quest } from './types.js';

const APP = 'roster-test';
const GROUP = '-100200';
const ADA = { id: 7, username: 'ada' };
const BO = { id: '9', first_name: 'Bo' };

const fresh = () => createHoloSphere({ appName: APP, store: { adapter: 'memory' } });

const card = (over: Partial<Quest> = {}): Quest => ({
  id: 'q1',
  title: 'Sweep the plaza',
  status: 'ongoing',
  participants: [],
  ...over,
});

/** What a person's holon holds at an address, pointers unresolved. */
const raw = (hs: any, holon: string, lens = 'quests', id = 'q1') =>
  hs.get(holon, lens, id, null, { resolveHolograms: false });

describe('rosterOf', () => {
  it('names participants, and the hosts of an event, once each', () => {
    const event = card({ type: 'event', participants: [ADA], hosts: [ADA, BO] });
    expect(rosterOf(event).map((p) => String(p.id))).toEqual(['7', '9']);
    // A task has no hosts, even with a stray list.
    expect(rosterOf(card({ participants: [ADA], hosts: [BO] })).map((p) => String(p.id))).toEqual(['7']);
    expect(rosterOf(card({ participants: JSON.stringify([BO]) as any }))).toEqual([BO]);
    expect(rosterOf(null)).toEqual([]);
  });
});

describe('attachRosterMirror', () => {
  it('is attached by the factory, once', () => {
    const hs = fresh();
    expect(hasRosterMirror(hs)).toBe(true);
    const put = hs.put;
    attachRosterMirror(hs as any);
    expect(hs.put).toBe(put);
    const off = createHoloSphere({ appName: APP, store: { adapter: 'memory' }, rosterMirror: false });
    expect(hasRosterMirror(off)).toBe(false);
  });

  it('puts a hologram of the card in the home holon of whoever is added', async () => {
    const hs = fresh();
    await hs.put(GROUP, 'quests', card());
    expect(await raw(hs, '7')).toBeNull();

    await hs.put(GROUP, 'quests', addParticipant(card(), ADA));
    expect(await raw(hs, '7')).toMatchObject({ id: 'q1', soul: `${APP}/${GROUP}/quests/q1` });
    // Read in their holon, it is the card itself.
    expect(await hs.get('7', 'quests', 'q1')).toMatchObject({ title: 'Sweep the plaza' });
    // Nobody else got one.
    expect(await raw(hs, '9')).toBeNull();
  });

  it('mirrors everyone a new card already names', async () => {
    const hs = fresh();
    await hs.put(GROUP, 'quests', card({ participants: [ADA, BO] }));
    expect(await raw(hs, '7')).toMatchObject({ soul: `${APP}/${GROUP}/quests/q1` });
    expect(await raw(hs, '9')).toMatchObject({ soul: `${APP}/${GROUP}/quests/q1` });
  });

  it('mirrors the hosts of an event too', async () => {
    const hs = fresh();
    const dinner = card({ id: 'd1', title: 'Full moon dinner', type: 'event', when: '2026-10-07T18:00:00.000Z' });
    await hs.put(GROUP, 'quests', dinner);
    await hs.put(GROUP, 'quests', addHost(dinner, BO));
    expect(await raw(hs, '9', 'quests', 'd1')).toMatchObject({ soul: `${APP}/${GROUP}/quests/d1` });
  });

  it('keeps an event of the events lens in the same lens', async () => {
    const hs = fresh();
    await hs.put(GROUP, 'events', card({ id: 'e1', type: 'event', participants: [ADA] }));
    expect(await raw(hs, '7', 'events', 'e1')).toMatchObject({ soul: `${APP}/${GROUP}/events/e1` });
    expect(await raw(hs, '7', 'quests', 'e1')).toBeNull();
  });

  it('drops the hologram of whoever is taken off', async () => {
    const hs = fresh();
    const full = card({ participants: [ADA, BO] });
    await hs.put(GROUP, 'quests', full);
    await hs.put(GROUP, 'quests', removeParticipant(full, 7));
    expect(await raw(hs, '7')).toBeNull();
    expect(await raw(hs, '9')).toMatchObject({ soul: `${APP}/${GROUP}/quests/q1` });
  });

  it('follows a roster replaced wholesale', async () => {
    const hs = fresh();
    const start = card({ participants: [ADA] });
    await hs.put(GROUP, 'quests', start);
    await hs.put(GROUP, 'quests', setParticipants(start, [BO]));
    expect(await raw(hs, '7')).toBeNull();
    expect(await raw(hs, '9')).toMatchObject({ soul: `${APP}/${GROUP}/quests/q1` });
  });

  it('writes nothing when the roster did not change', async () => {
    const hs = fresh();
    const joined = card({ participants: [ADA] });
    await hs.put(GROUP, 'quests', joined);
    const put = vi.spyOn(hs, 'put');
    await hs.put(GROUP, 'quests', { ...joined, title: 'Sweep the whole plaza' });
    // The store re-stamps the pointer it already holds (its own cascade);
    // the mirror itself writes nothing new.
    const mirrored = put.mock.calls.filter(([holon, , , , o]) => holon === '7' && !(o as any)?.isHologramUpdate);
    expect(mirrored).toHaveLength(0);
  });

  it('leaves a card that lives in the person\'s own holon alone', async () => {
    const hs = fresh();
    await hs.put('7', 'quests', card({ participants: [ADA] }));
    expect(await raw(hs, '7')).toMatchObject({ title: 'Sweep the plaza' });
  });

  it('never replaces or deletes another record under the same id', async () => {
    const hs = fresh();
    const own = card({ title: 'Ada\'s own errand' });
    await hs.put('7', 'quests', own);
    const log = vi.fn();
    const strict = createHoloSphere({ appName: APP, store: { adapter: 'memory' }, rosterMirror: false });
    attachRosterMirror(strict as any, { log });
    await strict.put('7', 'quests', own);

    await strict.put(GROUP, 'quests', card({ participants: [ADA] }));
    expect(await raw(strict, '7')).toMatchObject({ title: 'Ada\'s own errand' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('holds another record'));

    await strict.put(GROUP, 'quests', card());
    expect(await raw(strict, '7')).toMatchObject({ title: 'Ada\'s own errand' });
  });

  it('mirrors from where the card lives when it is edited through a hologram', async () => {
    const hs = fresh();
    await hs.put(GROUP, 'quests', card({ participants: [ADA] }));
    // Ada opens the card in her own holon and adds Bo there.
    const seen = (await hs.get('7', 'quests', 'q1')) as Quest;
    await hs.put('7', 'quests', addParticipant(seen, BO));
    expect(await hs.get(GROUP, 'quests', 'q1')).toMatchObject({ participants: [ADA, BO] });
    expect(await raw(hs, '9')).toMatchObject({ soul: `${APP}/${GROUP}/quests/q1` });
    // Her own pointer is untouched.
    expect(await raw(hs, '7')).toMatchObject({ soul: `${APP}/${GROUP}/quests/q1` });
  });

  it('ignores tombstones, private writes, pointers and federated copies', async () => {
    const hs = fresh();
    await hs.put(GROUP, 'quests', { ...card({ participants: [ADA] }), _federation: { origin: '-100999' } });
    await hs.put('-100300', 'quests', { id: 'q1', soul: `${APP}/${GROUP}/quests/q1` });
    await hs.put(GROUP, 'tasks_archive', card({ participants: [ADA] }));
    expect(await raw(hs, '7')).toBeNull();
  });

  it('writes the mirror with the same acting identity as the card', async () => {
    const hs = fresh();
    const put = vi.spyOn(hs, 'put');
    await hs.put(GROUP, 'quests', card({ participants: [ADA] }), { actingAs: 42, local: true });
    const mirror = put.mock.calls.find(([holon]) => holon === '7')!;
    expect(mirror[3]).toEqual({ actingAs: 42, local: true });
  });

  it('never blocks the card write when the mirror fails', async () => {
    const hs = createHoloSphere({ appName: APP, store: { adapter: 'memory' }, rosterMirror: false });
    const inner = hs.put.bind(hs);
    (hs as any).put = async (holon: any, ...rest: any[]) => {
      if (holon === '7') throw new Error('relay down');
      return (inner as any)(holon, ...rest);
    };
    const log = vi.fn();
    attachRosterMirror(hs as any, { log });
    await hs.put(GROUP, 'quests', card({ participants: [ADA] }));
    expect(await hs.get(GROUP, 'quests', 'q1')).toMatchObject({ participants: [ADA] });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('failed to mirror'), expect.any(Error));
  });
});

describe('attachRosterMirror under enforced reads', () => {
  it('a hub key the person never accepted mirrors a card that reads in their holon, and takes it back', async () => {
    // Ada's holon is her key: only she (and keys she linked) speak for it.
    const ada = testKey(), hub = testKey();
    const hs = createHoloSphere({ appName: APP, privateKey: hub.sk, store: { adapter: 'memory' } });
    await hs.ready();
    const her = { id: ada.pk, first_name: 'Ada' };

    await hs.put(GROUP, 'quests', card({ participants: [her] }));
    // The hub signed the pointer, the card it points at names her holon.
    expect((await hs.getAll(ada.pk, 'quests')).map((q: Quest) => q.title)).toEqual(['Sweep the plaza']);
    expect(await hs.getPending(ada.pk, 'quests')).toEqual([]);

    await hs.put(GROUP, 'quests', card());
    expect(await hs.getAll(ada.pk, 'quests')).toEqual([]);
    // Dropped, not merely hidden: the hub retracted its own pointer.
    expect((hs.store.get(ada.pk, 'quests', 'q1')?.item as any)?._deleted).toBe(true);
    await hs.close();
  });
});

