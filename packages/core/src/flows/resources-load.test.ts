// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createHoloSphere } from '../holosphere/factory.js';
import { signedEntry, testKey } from '../protocol/testing.js';
import { FLOW_RESOURCES_LENS, buildGift } from './resources.js';
import {
  disputeGift,
  giveResource,
  loadResources,
  receiveGift,
  removeResourceOffer,
  resourcesOf,
  saveResourceOffer,
} from './resources-load.js';

const APP = 'resources-load-test';
const T0 = 1_760_000_000;
const PROJECT = 'holon_alder';

async function project(sk = testKey().sk) {
  const hs: any = createHoloSphere({ appName: APP, privateKey: sk, store: { adapter: 'memory' } });
  await hs.ready();
  await hs.foundHolon(PROJECT, { at: T0 });
  hs._readAuthority?.invalidate();
  await hs.put(PROJECT, 'settings', { id: PROJECT, name: 'Alder' });
  return hs;
}

/** A gift signed by someone who is not the instance: as it arrives from a relay. */
const arrive = (hs: any, sk: Uint8Array, at: number, over: Partial<Parameters<typeof buildGift>[0]> = {}) => {
  const item = buildGift({ from: 'holon_seedbank', capital: 'material', amount: 1, unit: 'workspace', at: at * 1000, ...over }).item;
  const e = signedEntry({ sk, item: item as never, created_at: at, holon: PROJECT, lens: FLOW_RESOURCES_LENS, app: APP });
  hs.store.apply(e.event, { origin: 'remote' });
  return e.id;
};

describe('resources against the store', () => {
  it('an outsider\'s gift is read from the recipient\'s log, pending until an admin receives it', async () => {
    const hs = await project();
    const id = arrive(hs, testKey().sk, T0 + 10, { proof: 'https://example.org/photo' });
    let ctx = await loadResources(hs, PROJECT);
    expect(ctx.pending.map((g) => [g.id, g.from, g.proof])).toEqual([[id, 'holon_seedbank', 'https://example.org/photo']]);
    expect(ctx.base.count).toBe(0);

    await receiveGift(hs, PROJECT, id);
    ctx = await loadResources(hs, PROJECT);
    expect(ctx.received.map((g) => g.id)).toEqual([id]);
    expect((await resourcesOf(hs)(PROJECT)).count).toBe(1);
  });

  it('a dispute needs a reason and takes the gift out', async () => {
    const hs = await project();
    const id = arrive(hs, testKey().sk, T0 + 10);
    await expect(disputeGift(hs, PROJECT, id, ' ')).rejects.toThrow();
    await disputeGift(hs, PROJECT, id, 'never arrived');
    const ctx = await loadResources(hs, PROJECT);
    expect(ctx.gifts[0]).toMatchObject({ status: 'disputed', reason: 'never arrived' });
  });

  it('only an admin receives, disputes or edits offers', async () => {
    const hs = await project();
    const id = arrive(hs, testKey().sk, T0 + 10);
    const stranger: any = createHoloSphere({ appName: APP, privateKey: testKey().sk, store: { adapter: 'memory' } });
    await stranger.ready();
    for (const e of hs.store.events.values()) stranger.store.apply(e, { origin: 'remote' });
    await expect(receiveGift(stranger, PROJECT, id)).rejects.toThrow(/admin/);
    await expect(saveResourceOffer(stranger, PROJECT, { capital: 'material', title: 'Workspace' })).rejects.toThrow(/admin/);
  });

  it('the admin\'s own gift is received as written; giving names an existing offer or none', async () => {
    const hs = await project();
    await saveResourceOffer(hs, PROJECT, { capital: 'material', title: 'Workspace', terms: { when: 'weekdays', who: 'anyone in the Pot', how: 'ask a week ahead' } });
    await expect(giveResource(hs, PROJECT, { from: 'holon_seedbank', capital: 'material', amount: 1, unit: 'desk', offer: 'nope' })).rejects.toThrow(/offer/);
    await giveResource(hs, PROJECT, { from: 'holon_seedbank', capital: 'material', amount: 1, unit: 'desk', offer: 'workspace' });
    const ctx = await loadResources(hs, PROJECT);
    expect(ctx.received.map((g) => [g.offer, g.status])).toEqual([['workspace', 'received']]);
    expect(ctx.offers.map((o) => [o.id, o.terms.who])).toEqual([['workspace', 'anyone in the Pot']]);
    // The rest of the settings document survives an offer edit.
    expect((await hs.get(PROJECT, 'settings', PROJECT)).name).toBe('Alder');
    expect(await removeResourceOffer(hs, PROJECT, 'workspace')).toEqual([]);
  });
});
