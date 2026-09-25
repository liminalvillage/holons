// Private lenses on one instance: sealed on the wire, plaintext for the
// owner, locked after logout, open again after login.
import { testSphere, cleanupTestEnv } from './helpers/testenv.js';
import { generateSecretKey } from '../nostr-events.js';
import { isSealed, unsealSelf, cekOf } from '../store/sealed.js';
import { hexToBytes } from '@noble/hashes/utils';
import { isLocked } from '../store/index.js';

afterAll(cleanupTestEnv);

const H = '-100777';

describe('privacy: private lenses', () => {
    test('a private lens seals its content; the owner reads plaintext; the envelope shows nothing', async () => {
        const holo = await testSphere('priv-1');
        await holo.ready();
        await holo.privacy.setLensMode(H, 'quests', 'private');
        expect(holo.isPrivateLens(H, 'quests')).toBe(true);
        expect(holo.isPrivateLens(H, 'roles')).toBe(false);

        await holo.put(H, 'quests', { id: 'q1', title: 'secret plan' });
        const item = await holo.get(H, 'quests', 'q1');
        expect(item).toEqual({ id: 'q1', title: 'secret plan' });

        const [evt] = holo.store.getEvents(H, 'quests', 'q1');
        const payload = JSON.parse(evt.content);
        expect(isSealed(payload)).toBe(true);
        expect(evt.content).not.toContain('secret');
        expect(evt.tags).toEqual(expect.arrayContaining([['h', H], ['l', 'quests'], ['d', `${H}/quests/q1`]]));

        // The vault is sealed to the owner too.
        const [vault] = holo.store.getEvents(H, '_vault', 'lens:quests');
        expect(JSON.parse(vault.content).kid).toBe('self');
        expect(vault.content).not.toContain(payload.kid);
    });

    test('an edit keeps the item content key; a public lens stays plain', async () => {
        const sk = generateSecretKey();
        const holo = await testSphere('priv-2', { privateKey: sk });
        await holo.ready();
        await holo.privacy.setLensMode(H, 'quests', 'private');
        await holo.put(H, 'quests', { id: 'q1', title: 'v1' });
        const first = JSON.parse(holo.store.getEvents(H, 'quests', 'q1')[0].content);
        await holo.put(H, 'quests', { id: 'q1', title: 'v2' });
        const second = JSON.parse(holo.store.getEvents(H, 'quests', 'q1')[0].content);
        const vault = unsealSelf(JSON.parse(holo.store.getEvents(H, '_vault', 'lens:quests')[0].content), sk);
        const lensKey = hexToBytes(vault.keys.find((k) => k.kid === vault.current).key);
        expect(cekOf(second, lensKey)).toEqual(cekOf(first, lensKey));
        expect(second.ct).not.toBe(first.ct);
        expect((await holo.getAll(H, 'quests')).map((q) => q.title)).toEqual(['v2']);

        await holo.put(H, 'roles', { id: 'r1', name: 'gardener' });
        expect(holo.store.getEvents(H, 'roles', 'r1')[0].content).toContain('gardener');
    });

    test('logout locks every sealed record; login with the same key opens them again', async () => {
        const sk = generateSecretKey();
        const holo = await testSphere('priv-3', { privateKey: sk });
        await holo.ready();
        await holo.privacy.setLensMode(H, 'quests', 'private');
        await holo.put(H, 'quests', { id: 'q1', title: 'mine' });

        await holo.logout();
        expect(isLocked(holo.store.get(H, 'quests', 'q1').item)).toBe(true);
        expect(await holo.getAll(H, 'quests')).toEqual([]);
        expect(await holo.get(H, 'quests', 'q1')).toBeNull();
        expect(await holo.get(H, 'quests', 'q1', null, { includeLocked: true })).toEqual({ id: 'q1', _locked: true, _kid: expect.any(String) });

        await holo.login(sk);
        expect((await holo.getAll(H, 'quests')).map((q) => q.title)).toEqual(['mine']);
    });

    test('a subscriber hides locked records and hears them once keys arrive', async () => {
        const sk = generateSecretKey();
        const holo = await testSphere('priv-4', { privateKey: sk });
        await holo.ready();
        await holo.privacy.setLensMode(H, 'quests', 'private');
        await holo.put(H, 'quests', { id: 'q1', title: 'live' });
        await holo.logout();

        const seen = [];
        const sub = holo.subscribe(H, 'quests', (item, key) => seen.push([key, item?.title ?? null]));
        await new Promise((r) => setTimeout(r, 20));
        expect(seen).toEqual([]);
        await holo.login(sk);
        await holo.getAll(H, 'quests');          // loads the vault → rescan → the feed fires
        await new Promise((r) => setTimeout(r, 20));
        expect(seen).toEqual([['q1', 'live']]);
        sub.unsubscribe();
    });

    test('lenses that cannot be private are refused; a global put is never sealed', async () => {
        const holo = await testSphere('priv-5');
        await holo.ready();
        await expect(holo.privacy.setLensMode(H, 'settings', 'private')).rejects.toThrow(/cannot be private/);
        await expect(holo.privacy.setLensMode(H, '_members', 'private')).rejects.toThrow(/cannot be private/);
        await expect(holo.privacy.setLensMode(null, 'quests', 'private')).rejects.toThrow(/global/);
        holo.registerAppendLens('claims');
        await expect(holo.privacy.setLensMode(H, 'claims', 'private')).rejects.toThrow(/append-only/);
        await expect(holo.put(H, 'settings', { id: H, name: 'x' }, { privacy: 'private' })).rejects.toThrow(/cannot be private/);
    });

    test('a per-put override seals one write, and public mode stops sealing new writes', async () => {
        const holo = await testSphere('priv-6');
        await holo.ready();
        await holo.put(H, 'notes', { id: 'n1', body: 'hush' }, { privacy: 'private' });
        expect(holo.store.getEvents(H, 'notes', 'n1')[0].content).not.toContain('hush');
        expect(await holo.get(H, 'notes', 'n1')).toEqual({ id: 'n1', body: 'hush' });
        expect(holo.isPrivateLens(H, 'notes')).toBe(true);   // the vault now exists

        await holo.privacy.setLensMode(H, 'notes', 'public');
        expect(holo.isPrivateLens(H, 'notes')).toBe(false);
        await holo.put(H, 'notes', { id: 'n2', body: 'loud' });
        expect(holo.store.getEvents(H, 'notes', 'n2')[0].content).toContain('loud');
        expect((await holo.getAll(H, 'notes')).map((n) => n.id).sort()).toEqual(['n1', 'n2']);
    });

    test('a hologram from a private lens is fine, a detached copy is refused', async () => {
        const holo = await testSphere('priv-7');
        await holo.ready();
        await holo.privacy.setLensMode(H, 'quests', 'private');
        await holo.put(H, 'quests', { id: 'q1', title: 'x' });
        await holo.federate(H, '-100888', null, null, true, { inbound: [], outbound: ['quests'] });
        await expect(holo.propagate(H, 'quests', { id: 'q1', title: 'x' }, { useHolograms: false })).rejects.toThrow(/private/);
        const r = await holo.propagate(H, 'quests', { id: 'q1', title: 'x' }, { useHolograms: true, propagateToParents: false });
        expect(r.errors).toBe(0);
    });

    test('a grant payload must be well-formed and self-certifying', async () => {
        const holo = await testSphere('priv-8');
        const { parseGrant } = holo.privacy;
        const key = 'ab'.repeat(32);
        const { kidOf } = await import('../store/sealed.js');
        expect(parseGrant({ t: 'holons/grant', v: 1, holon: H, lens: 'quests', kid: kidOf(key), key })).toMatchObject({ holon: H, key });
        expect(parseGrant({ t: 'holons/grant', v: 1, holon: H, lens: 'quests', kid: '0'.repeat(16), key })).toBeNull();
        expect(parseGrant({ t: 'holons/grant', v: 1, holon: H, lens: 'quests', kid: kidOf(key), item: 'q1', cek: 'zz' })).toBeNull();
        expect(parseGrant('not json')).toBeNull();
        expect(await holo.privacy.acceptGrant({ t: 'nope' })).toEqual({ accepted: false, reason: 'malformed' });
    });
});
