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

describe('two key-founded holons', () => {
  it('federate both ways and resolve their readers to each genesis', async () => {
    const p = testKey(), q = testKey();
    const hs = createHoloSphere({ appName: 'founded-fed-test', privateKey: bytesToHex(p.sk), store: { adapter: 'memory' } });
    const A = newHolonId(), B = newHolonId();
    await foundHolon(hs, A, { name: 'Orto' });
    await hs.login(bytesToHex(q.sk));
    await foundHolon(hs, B, { name: 'Forno' });

    // The federation record is an admin's word: a link counts on each side
    // only when its signer is an admin THERE. q (B's admin) linking A↔B
    // opens B's side; on A it is recorded and ignored until p links.
    await setFederationPartner(hs, A, B, { inbound: ['quests'], outbound: ['quests', 'library'], partnerName: 'Forno' });
    expect((await getFederationSnapshot(hs, A)).federated).not.toContain(B);
    const b = await getFederationSnapshot(hs, B);
    expect(b.endorsed).toBe(true);
    expect(b.federated).toContain(A);
    expect(b.lensConfig[A]).toMatchObject({ inbound: ['quests', 'library'], outbound: ['quests'] });
    await hs.login(bytesToHex(p.sk));
    await setFederationPartner(hs, A, B, { inbound: ['quests'], outbound: ['quests', 'library'], partnerName: 'Forno' });
    const a = await getFederationSnapshot(hs, A);
    expect(a.endorsed).toBe(true);
    expect(a.federated).toContain(B);
    expect(a.lensConfig[B]).toMatchObject({ inbound: ['quests'], outbound: ['quests', 'library'] });

    expect(await holonReaders(hs, A)).toEqual({ keys: [p.pk], kind: 'group' });
    expect(await holonReaders(hs, B)).toEqual({ keys: [q.pk], kind: 'group' });

    await removeFederationPartner(hs, A, B);
    expect((await getFederationSnapshot(hs, A)).federated).not.toContain(B);
    await hs.close();
  });
});
