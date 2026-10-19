// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createHoloSphere } from '../holosphere/factory.js';
import { getFederationSnapshot } from '../federation/snapshot.js';
import { signedEntry, testKey } from '../protocol/testing.js';
import { FLOW_APPLICATIONS_LENS, buildApplication } from './applications.js';
import {
  applyToFund,
  approveApplication,
  declineApplication,
  loadApplications,
  setApplicationsOpen,
  withdrawApplication,
} from './applications-load.js';
import { readZoneAssignments, readZonePeople } from './settings.js';

const APP = 'applications-load-test';
const T0 = 1_760_000_000;
const FUND = 'holon_fund';
const PROJECT = 'holon_alder';
const PERSON = '4242';

async function fund(sk = testKey().sk) {
  const hs: any = createHoloSphere({ appName: APP, privateKey: sk, store: { adapter: 'memory' } });
  await hs.ready();
  await hs.foundHolon(FUND, { at: T0 });
  hs._readAuthority?.invalidate();
  await hs.put(FUND, 'settings', { id: FUND, allocation: { interiorPercent: 0, steepness: 50, nzones: 3 } });
  return hs;
}

/** An ask signed by someone who is not the instance: as it arrives from a relay. */
const arrive = (hs: any, sk: Uint8Array, party: string, at: number, note?: string) => {
  const e = signedEntry({ sk, item: buildApplication({ party, note, at: at * 1000 }).item as never, created_at: at, holon: FUND, lens: FLOW_APPLICATIONS_LENS, app: APP });
  hs.store.apply(e.event, { origin: 'remote' });
  return e.id;
};

describe('applications against the store', () => {
  it('an outsider\'s ask is read from the fund\'s log, and the fund is open by default', async () => {
    const hs = await fund();
    const id = arrive(hs, testKey().sk, PROJECT, T0 + 10, 'we plant trees');
    const ctx = await loadApplications(hs, FUND);
    expect(ctx.open).toBe(true);
    expect(ctx.pending.map((a) => [a.id, a.party, a.note, a.verified])).toEqual([[id, PROJECT, 'we plant trees', false]]);
  });

  it('approving a holon links it, places it on the outermost ring and attests — once', async () => {
    const hs = await fund();
    const id = arrive(hs, testKey().sk, PROJECT, T0 + 10);
    expect(await approveApplication(hs, FUND, id)).toEqual({ party: PROJECT, kind: 'holon', ring: 3, linked: true, placed: true });
    const settings = await hs.get(FUND, 'settings', FUND);
    expect(readZoneAssignments(settings)).toEqual({ [PROJECT]: 3 });
    expect((await getFederationSnapshot(hs, FUND)).federated).toContain(PROJECT);
    expect((await loadApplications(hs, FUND)).byParty[PROJECT].status).toBe('approved');

    // Again: nothing left to do, and nothing is moved.
    expect(await approveApplication(hs, FUND, id, { ring: 1 })).toEqual({ party: PROJECT, kind: 'holon', ring: 3, linked: false, placed: false });
    expect(readZoneAssignments(await hs.get(FUND, 'settings', FUND))).toEqual({ [PROJECT]: 3 });
  });

  it('approving a person places them among the people, on the ring asked for', async () => {
    const hs = await fund();
    const id = arrive(hs, testKey().sk, PERSON, T0 + 10);
    expect(await approveApplication(hs, FUND, id, { ring: 2 })).toEqual({ party: PERSON, kind: 'person', ring: 2, linked: false, placed: true });
    const settings = await hs.get(FUND, 'settings', FUND);
    expect(readZonePeople(settings)).toEqual({ [PERSON]: 2 });
    expect(readZoneAssignments(settings)).toEqual({});
  });

  it('declining says why and touches nothing else', async () => {
    const hs = await fund();
    const id = arrive(hs, testKey().sk, PROJECT, T0 + 10);
    await declineApplication(hs, FUND, id, 'not this round');
    expect((await loadApplications(hs, FUND)).byParty[PROJECT]).toMatchObject({ status: 'declined', reason: 'not this round' });
    expect(readZoneAssignments(await hs.get(FUND, 'settings', FUND))).toEqual({});
  });

  it('only an admin answers', async () => {
    const admin = testKey();
    const hs = await fund(admin.sk);
    const id = arrive(hs, testKey().sk, PROJECT, T0 + 10);
    const stranger: any = createHoloSphere({ appName: APP, privateKey: testKey().sk, store: { adapter: 'memory' } });
    await stranger.ready();
    for (const e of hs.store.events.values()) stranger.store.apply(e, { origin: 'remote' });
    await expect(approveApplication(stranger, FUND, id)).rejects.toThrow(/admin/);
    await expect(declineApplication(stranger, FUND, id)).rejects.toThrow(/admin/);
    await expect(approveApplication(hs, FUND, 'nope')).rejects.toThrow(/not on this fund/);
  });

  it('asking, asking twice, taking back, and a closed fund', async () => {
    const hs = await fund();
    const { id } = await applyToFund(hs, FUND, { party: PROJECT, name: 'Alder', note: 'hello' });
    expect((await loadApplications(hs, FUND)).byParty[PROJECT]).toMatchObject({ id, status: 'pending', name: 'Alder' });
    await expect(applyToFund(hs, FUND, { party: PROJECT })).rejects.toThrow(/already waiting/);
    await expect(applyToFund(hs, FUND, { party: FUND })).rejects.toThrow(/itself/);
    await withdrawApplication(hs, FUND, PROJECT);
    expect((await loadApplications(hs, FUND)).byParty[PROJECT].status).toBe('withdrawn');
    await expect(withdrawApplication(hs, FUND, PROJECT)).rejects.toThrow(/no waiting/);

    await setApplicationsOpen(hs, FUND, false);
    expect((await loadApplications(hs, FUND)).open).toBe(false);
    await expect(applyToFund(hs, FUND, { party: PROJECT })).rejects.toThrow(/not taking/);
    // Closing survives an unrelated save of the split, and reopening clears it.
    await setApplicationsOpen(hs, FUND, true);
    expect((await hs.get(FUND, 'settings', FUND)).allocation).not.toHaveProperty('applications');
  });
});
