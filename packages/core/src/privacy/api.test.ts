// SPDX-License-Identifier: AGPL-3.0-or-later
// The privacy API on a real local-only instance built by the core factory —
// the way every UI gets one.
import { describe, expect, it } from 'vitest';
import { generateSecretKey } from 'nostr-tools/pure';
import { createHoloSphere } from '../holosphere/factory.js';
import { readHolonSettings } from '../settings/persistence.js';
import { getPrivacySnapshot, grantItem, grantLens, listGrants, revokeLens, setLensPrivacy } from './api.js';

const H = '-100777';
const PARTNER = 'cd'.repeat(32);

// A logged-in owner: the key is what the vault is sealed to.
function fresh() {
  return createHoloSphere({ appName: 'privacy-api-test', privateKey: generateSecretKey(), store: { adapter: 'memory' } });
}

describe('privacy api', () => {
  it('setLensPrivacy seals the lens and keeps the public hint in step', async () => {
    const hs = fresh();
    await setLensPrivacy(hs, H, 'quests', 'private');
    await hs.put(H, 'quests', { id: 'q1', title: 'hidden' });
    expect(hs.store.getEvents(H, 'quests', 'q1')[0].content).not.toContain('hidden');
    expect(await hs.getAll(H, 'quests')).toEqual([{ id: 'q1', title: 'hidden' }]);
    const settings = await readHolonSettings(hs, H);
    expect(settings?.privacy).toEqual({ lenses: { quests: 'private' } });

    const snap = await getPrivacySnapshot(hs, H);
    expect(snap.lenses).toEqual({ quests: 'private' });
    expect(snap.owned).toEqual(['quests']);

    await setLensPrivacy(hs, H, 'quests', 'public');
    expect((await readHolonSettings(hs, H))?.privacy).toEqual({ lenses: {} });
    await hs.put(H, 'quests', { id: 'q2', title: 'loud' });
    expect(hs.store.getEvents(H, 'quests', 'q2')[0].content).toContain('loud');
  });

  it('refuses lenses that cannot be private', async () => {
    const hs = fresh();
    await expect(setLensPrivacy(hs, H, 'settings', 'private')).rejects.toThrow(/cannot be private/);
    await expect(setLensPrivacy(hs, H, '_policy', 'private')).rejects.toThrow(/append-only/);
  });

  it('grants resolve a grantee and land in the ledger; the sealed lens gets no plaintext ledger line', async () => {
    const hs = fresh();
    await setLensPrivacy(hs, H, 'quests', 'private');
    await hs.put(H, 'quests', { id: 'q1', title: 'hidden', status: 'ongoing', initiator: { id: 7, username: 'ada' }, participants: [] });
    // No relays: the grant is recorded even though the DM has nowhere to go.
    const g = await grantItem(hs, H, 'quests', 'q1', PARTNER);
    expect(g).toMatchObject({ sent: false, grantee: PARTNER, item: 'q1' });
    await grantLens(hs, H, 'quests', PARTNER);
    expect(await listGrants(hs, H, 'quests')).toEqual({ [PARTNER]: { lenses: ['quests'], items: { quests: ['q1'] } } });
    expect((await getPrivacySnapshot(hs, H)).grants[PARTNER].lenses).toEqual(['quests']);
    await expect(grantLens(hs, H, 'quests', '-100999')).rejects.toThrow(/nothing signed says who speaks/);

    expect(hs.store.list(H, 'rea_events')).toEqual([]);   // sealed quest → no plaintext ledger

    const r = await revokeLens(hs, H, 'quests', PARTNER);
    expect(r.rewritten).toBe(1);
    expect(await listGrants(hs, H, 'quests')).toEqual({ [PARTNER]: { lenses: [], items: { quests: ['q1'] } } });
    expect(await hs.getAll(H, 'quests')).toHaveLength(1);
  });
});
