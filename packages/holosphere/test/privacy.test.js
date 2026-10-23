// Private scopes on one instance: a locked lens or a locked card is sealed on
// the wire, plaintext for the owner, locked after logout, open after login.
import { testSphere, cleanupTestEnv } from './helpers/testenv.js';
import { generateSecretKey, getPublicKey } from '../nostr-events.js';
import { isSealed, unsealSelf, kidOf } from '../store/sealed.js';
import { isLocked } from '../store/index.js';

import { withoutClock } from './helpers/clock.js';
afterAll(cleanupTestEnv);

const H = '-100777';
const content = (holo, lens, id) => JSON.parse(holo.store.getEvents(H, lens, id)[0].content);

describe('privacy: private scopes', () => {
    test('locking a lens seals its content; the owner reads plaintext; the envelope shows nothing', async () => {
        const holo = await testSphere('priv-1');
        await holo.ready();
        await holo.put(H, 'quests', { id: 'q0', title: 'written before the lock' });
        const r = await holo.privacy.lock({ holon: H, lens: 'quests' });
        expect(r.rewritten).toBe(1);
        expect(holo.isPrivate(H, 'quests')).toBe(true);
        expect(holo.isPrivate(H, 'quests', 'q0')).toBe(true);
        expect(holo.isPrivate(H, 'roles')).toBe(false);
        expect(holo.privacy.lockedScopes(H)).toEqual({ quests: { locked: true, items: [] } });
        expect(holo.privacy.owned({ holon: H, lens: 'quests' })).toBe(true);

        await holo.put(H, 'quests', { id: 'q1', title: 'secret plan' });
        expect(withoutClock(await holo.get(H, 'quests', 'q1'))).toEqual({ id: 'q1', title: 'secret plan' });
        for (const id of ['q0', 'q1']) {
            const [evt] = holo.store.getEvents(H, 'quests', id);
            expect(isSealed(JSON.parse(evt.content))).toBe(true);
            expect(evt.content).not.toMatch(/secret|before/);
        }
        expect(holo.store.getEvents(H, 'quests', 'q1')[0].tags).toEqual(expect.arrayContaining([['h', H], ['l', 'quests'], ['d', `${H}/quests/q1`]]));

        // The vault is sealed to the owner too, under the lens's own id.
        const [vault] = holo.store.getEvents(H, '_vault', 'quests');
        expect(JSON.parse(vault.content).kid).toBe('self');
        expect(vault.content).not.toContain(content(holo, 'quests', 'q1').kid);

        // Locking twice is a no-op.
        expect(await holo.privacy.lock({ holon: H, lens: 'quests' })).toEqual({ kid: content(holo, 'quests', 'q1').kid, rewritten: 0 });
    });

    test('locking one card seals only that card; the rest of the lens stays plain', async () => {
        const sk = generateSecretKey();
        const holo = await testSphere('priv-2', { privateKey: sk });
        await holo.ready();
        await holo.put(H, 'quests', { id: 'q1', title: 'public one' });
        await holo.put(H, 'quests', { id: 'q2', title: 'hush' });
        await holo.privacy.lock({ holon: H, lens: 'quests', item: 'q2' });
        expect(holo.isPrivate(H, 'quests')).toBe(false);
        expect(holo.isPrivate(H, 'quests', 'q1')).toBe(false);
        expect(holo.isPrivate(H, 'quests', 'q2')).toBe(true);
        expect(holo.privacy.lockedScopes(H)).toEqual({ quests: { locked: false, items: ['q2'] } });
        expect(isSealed(content(holo, 'quests', 'q2'))).toBe(true);
        expect(holo.store.getEvents(H, 'quests', 'q1')[0].content).toContain('public one');

        // New writes follow the same rule: q2 stays sealed, q3 goes out plain.
        await holo.put(H, 'quests', { id: 'q2', title: 'hush v2' });
        await holo.put(H, 'quests', { id: 'q3', title: 'also public' });
        expect(isSealed(content(holo, 'quests', 'q2'))).toBe(true);
        expect(holo.store.getEvents(H, 'quests', 'q3')[0].content).toContain('also public');
        expect((await holo.getAll(H, 'quests')).map((q) => q.title).sort()).toEqual(['also public', 'hush v2', 'public one']);

        // The card's vault record is at `quests/q2`, sealed to the owner, and the key hashes to the envelope's kid.
        const vault = unsealSelf(JSON.parse(holo.store.getEvents(H, '_vault', 'quests/q2')[0].content), sk);
        expect(vault.scope).toEqual({ holon: H, lens: 'quests', item: 'q2' });
        expect(kidOf(vault.keys[0].key)).toBe(content(holo, 'quests', 'q2').kid);

        // Locking the whole lens folds the card's vault: one scope governs.
        await holo.privacy.lock({ holon: H, lens: 'quests' });
        expect(holo.privacy.lockedScopes(H)).toEqual({ quests: { locked: true, items: [] } });
        expect(holo.privacy.scopeOf(H, 'quests', 'q2')).toEqual({ holon: H, lens: 'quests' });
        expect(isSealed(content(holo, 'quests', 'q1'))).toBe(true);
    });

    test('unlocking rewrites the scope in the clear and tombstones the vault', async () => {
        const holo = await testSphere('priv-3');
        await holo.ready();
        await holo.privacy.lock({ holon: H, lens: 'quests' });
        await holo.put(H, 'quests', { id: 'q1', title: 'was sealed' });
        const r = await holo.privacy.unlock({ holon: H, lens: 'quests' });
        expect(r.rewritten).toBe(1);
        expect(holo.isPrivate(H, 'quests')).toBe(false);
        expect(holo.privacy.lockedScopes(H)).toEqual({});
        expect(holo.store.getEvents(H, 'quests', 'q1')[0].content).toContain('was sealed');
        expect(holo.store.get(H, '_vault', 'quests').item._deleted).toBe(true);
        await holo.put(H, 'quests', { id: 'q2', title: 'plain again' });
        expect(holo.store.getEvents(H, 'quests', 'q2')[0].content).toContain('plain again');

        // A card: same rule.
        await holo.privacy.lock({ holon: H, lens: 'quests', item: 'q2' });
        expect(isSealed(content(holo, 'quests', 'q2'))).toBe(true);
        await holo.privacy.unlock({ holon: H, lens: 'quests', item: 'q2' });
        expect(holo.store.getEvents(H, 'quests', 'q2')[0].content).toContain('plain again');
        expect(holo.privacy.lockedScopes(H)).toEqual({});
    });

    test('logout locks every sealed record; login with the same key opens them again', async () => {
        const sk = generateSecretKey();
        const holo = await testSphere('priv-4', { privateKey: sk });
        await holo.ready();
        await holo.privacy.lock({ holon: H, lens: 'quests' });
        await holo.put(H, 'quests', { id: 'q1', title: 'mine' });

        await holo.logout();
        expect(isLocked(holo.store.get(H, 'quests', 'q1').item)).toBe(true);
        expect(await holo.getAll(H, 'quests')).toEqual([]);
        expect(await holo.get(H, 'quests', 'q1')).toBeNull();
        expect(await holo.get(H, 'quests', 'q1', null, { includeLocked: true })).toEqual({ id: 'q1', _locked: true, _kid: expect.any(String) });
        // The flag survives the logout: the vault record is still there (as a stub).
        expect(holo.isPrivate(H, 'quests')).toBe(true);

        await holo.login(sk);
        expect((await holo.getAll(H, 'quests')).map((q) => q.title)).toEqual(['mine']);
    });

    test('a subscription hears a sealed record once the keys load', async () => {
        const sk = generateSecretKey();
        const holo = await testSphere('priv-5', { privateKey: sk });
        await holo.ready();
        await holo.privacy.lock({ holon: H, lens: 'quests' });
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

    test('lenses that cannot be private are refused', async () => {
        const holo = await testSphere('priv-6');
        await holo.ready();
        await expect(holo.privacy.lock({ holon: H, lens: 'settings' })).rejects.toThrow(/cannot be private/);
        await expect(holo.privacy.lock({ holon: H, lens: '_members' })).rejects.toThrow(/cannot be private/);
        await expect(holo.privacy.lock({ holon: null, lens: 'quests' })).rejects.toThrow(/holon and a lens/);
        holo.registerAppendLens('claims');
        await expect(holo.privacy.lock({ holon: H, lens: 'claims' })).rejects.toThrow(/append-only/);
        await expect(holo.privacy.unlock({ holon: H, lens: 'quests' })).rejects.toThrow(/not a private scope you own/);
    });

    test('a hologram from a private scope is fine, a detached copy is refused', async () => {
        const holo = await testSphere('priv-7');
        await holo.ready();
        await holo.put(H, 'quests', { id: 'q1', title: 'x' });
        await holo.put(H, 'quests', { id: 'q2', title: 'y' });
        await holo.privacy.lock({ holon: H, lens: 'quests', item: 'q1' });
        await holo.federate(H, '-100888', null, null, true, { inbound: [], outbound: ['quests'] });
        await expect(holo.propagate(H, 'quests', { id: 'q1', title: 'x' }, { useHolograms: false })).rejects.toThrow(/private/);
        const plain = await holo.propagate(H, 'quests', { id: 'q2', title: 'y' }, { useHolograms: false, propagateToParents: false });
        expect(plain.errors).toBe(0);
        const r = await holo.propagate(H, 'quests', { id: 'q1', title: 'x' }, { useHolograms: true, propagateToParents: false });
        expect(r.errors).toBe(0);
    });

    test('a grant payload must be well-formed and self-certifying', async () => {
        const holo = await testSphere('priv-8');
        const { parseGrant } = holo.privacy;
        const key = 'ab'.repeat(32);
        expect(parseGrant({ t: 'holons/grant', v: 2, holon: H, lens: 'quests', kid: kidOf(key), key })).toEqual({ t: 'holons/grant', v: 2, holon: H, lens: 'quests', kid: kidOf(key), key, at: expect.any(String) });
        expect(parseGrant({ t: 'holons/grant', v: 2, holon: H, lens: 'quests', item: 'q1', kid: kidOf(key), key })).toMatchObject({ item: 'q1' });
        expect(parseGrant({ t: 'holons/grant', v: 2, holon: H, lens: 'quests', kid: '0'.repeat(16), key })).toBeNull();
        expect(parseGrant({ t: 'holons/grant', v: 1, holon: H, lens: 'quests', kid: kidOf(key), key })).toBeNull();
        expect(parseGrant('not json')).toBeNull();
        expect(await holo.privacy.acceptGrant({ t: 'nope' })).toEqual({ accepted: false, reason: 'malformed' });
    });

    test('a personal holon locks its own lens; the id is the key', async () => {
        const sk = generateSecretKey();
        const me = getPublicKey(sk);
        const holo = await testSphere('priv-9', { privateKey: sk });
        await holo.ready();
        await holo.privacy.lock({ holon: me, lens: 'notes' });
        await holo.put(me, 'notes', { id: 'n1', body: 'diary' });
        expect(JSON.parse(holo.store.getEvents(me, 'notes', 'n1')[0].content).ct).toBeDefined();
        expect(withoutClock(await holo.get(me, 'notes', 'n1'))).toEqual({ id: 'n1', body: 'diary' });
        expect(holo.privacy.ownedScopes(me)).toEqual([{ holon: me, lens: 'notes' }]);
    });
});
