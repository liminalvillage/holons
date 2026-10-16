// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Federation between two holons founded from a screen, with no bot in the
// loop: the pair links both ways and each side's readers are its genesis.

import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { createHoloSphere } from '../holosphere/factory.js';
import { holonReaders } from '../privacy/readers.js';
import { foundHolon, newHolonId } from '../protocol/founding.js';
import { testKey } from '../protocol/testing.js';
import { getFederationSnapshot } from './snapshot.js';
import { removeFederationPartner, setFederationPartner } from './partners.js';
import { answerFederationRequest, pendingFederationRequests } from './requests.js';

describe('two key-founded holons', () => {
  it('federate both ways and resolve their readers to each genesis', async () => {
    const p = testKey(), q = testKey();
    const hs = createHoloSphere({ appName: 'founded-fed-test', privateKey: bytesToHex(p.sk), store: { adapter: 'memory' } });
    const A = newHolonId(), B = newHolonId();
    await foundHolon(hs, A, { name: 'Orto' });
    await hs.login(bytesToHex(q.sk));
    await foundHolon(hs, B, { name: 'Forno' });

    // The federation record is an admin's word: each half is set by an
    // admin of its own holon. q (B's admin) links B↔A: B's half is written
    // and A is ASKED; p (A's admin) accepts, which writes A's half.
    expect(await setFederationPartner(hs, B, A, { inbound: ['quests', 'library'], outbound: ['quests'], partnerName: 'Orto', holonName: 'Forno' }))
      .toEqual({ self: 'linked', partner: 'requested' });
    expect((await getFederationSnapshot(hs, A)).federated).not.toContain(B);
    const b = await getFederationSnapshot(hs, B);
    expect(b.endorsed).toBe(true);
    expect(b.lensConfig[A]).toMatchObject({ inbound: ['library', 'quests'], outbound: ['quests'] });
    await hs.login(bytesToHex(p.sk));
    const [req] = await pendingFederationRequests(hs, A);
    expect(req).toMatchObject({ from: B, fromName: 'Forno', inbound: ['quests'], outbound: ['library', 'quests'] });
    await answerFederationRequest(hs, A, B, 'accept');
    const a = await getFederationSnapshot(hs, A);
    expect(a.endorsed).toBe(true);
    expect(a.partnerNames[B]).toBe('Forno');
    expect(a.lensConfig[B]).toMatchObject({ inbound: ['quests'], outbound: ['library', 'quests'] });

    expect(await holonReaders(hs, A)).toEqual({ keys: [p.pk], kind: 'group' });
    expect(await holonReaders(hs, B)).toEqual({ keys: [q.pk], kind: 'group' });

    expect(await removeFederationPartner(hs, A, B)).toEqual({ self: 'removed', partner: 'requested' });
    expect((await getFederationSnapshot(hs, A)).federated).not.toContain(B);
    expect((await pendingFederationRequests(hs, B))[0]).toMatchObject({ from: A, kind: 'unlink' });
    await hs.close();
  });
});
