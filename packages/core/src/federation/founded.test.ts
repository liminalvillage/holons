// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Federation between two holons founded from a screen, with no bot in the
// loop: the pair links both ways and each side's keys go to its genesis.

import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { createHoloSphere } from '../holosphere/factory.js';
import { resolveGranteePubkey } from '../privacy/resolve.js';
import { foundHolon, newHolonId } from '../protocol/founding.js';
import { testKey } from '../protocol/testing.js';
import { getFederationSnapshot } from './snapshot.js';
import { removeFederationPartner, setFederationPartner } from './partners.js';

describe('two key-founded holons', () => {
  it('federate both ways and resolve their grantee keys to each genesis', async () => {
    const p = testKey(), q = testKey();
    const hs = createHoloSphere({ appName: 'founded-fed-test', privateKey: bytesToHex(p.sk), store: { adapter: 'memory' } });
    const A = newHolonId(), B = newHolonId();
    await foundHolon(hs, A, { name: 'Orto' });
    await hs.login(bytesToHex(q.sk));
    await foundHolon(hs, B, { name: 'Forno' });

    await setFederationPartner(hs, A, B, { inbound: ['quests'], outbound: ['quests', 'library'], partnerName: 'Forno' });
    const a = await getFederationSnapshot(hs, A);
    expect(a.federated).toContain(B);
    expect(a.lensConfig[B]).toMatchObject({ inbound: ['quests'], outbound: ['quests', 'library'] });
    expect((await getFederationSnapshot(hs, B)).federated).toContain(A);

    expect(await resolveGranteePubkey(hs, A)).toEqual({ pubkey: p.pk, via: 'anchor' });
    expect(await resolveGranteePubkey(hs, B)).toEqual({ pubkey: q.pk, via: 'anchor' });

    await removeFederationPartner(hs, A, B);
    expect((await getFederationSnapshot(hs, A)).federated).not.toContain(B);
    await hs.close();
  });
});
