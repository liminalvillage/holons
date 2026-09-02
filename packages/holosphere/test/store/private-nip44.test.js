import { createStore, createMemoryAdapter, privateLens } from '../../store/index.js';
import { APP } from './helpers.js';

const { deriveKey, seal, open, privateScope, KDF } = privateLens;

describe('store/private: NIP-44 password lenses', () => {
    test('scope string mirrors the old SEA username: app:holon, or app:lens for globals', () => {
        expect(privateScope('Holons', '-100123', 'notes')).toBe('Holons:-100123');
        expect(privateScope('Holons', null, 'notes')).toBe('Holons:notes');
        expect(privateScope('Holons', undefined, 'notes')).toBe('Holons:notes');
    });

    test('KDF parameters are frozen', () => {
        expect(KDF).toEqual({ N: 32768, r: 8, p: 1, dkLen: 32 });
        expect(Object.isFrozen(KDF)).toBe(true);
    });

    test('same password + scope → same key; different scope → different key', async () => {
        const k1 = await deriveKey('hunter2', 'App:h1');
        const k2 = await deriveKey('hunter2', 'App:h1');
        const k3 = await deriveKey('hunter2', 'App:h2');
        expect(k1).toHaveLength(32);
        expect(Buffer.from(k1).equals(Buffer.from(k2))).toBe(true);
        expect(Buffer.from(k1).equals(Buffer.from(k3))).toBe(false);
    });

    test('empty password is refused', async () => {
        await expect(deriveKey('', 'App:h1')).rejects.toThrow(/password/);
    });

    test('seal/open round-trips; a wrong key fails the MAC', async () => {
        const good = await deriveKey('right', 'App:h1');
        const bad = await deriveKey('wrong', 'App:h1');
        const payload = seal({ id: 'n1', secret: 'x' }, good);
        expect(typeof payload).toBe('string');
        expect(payload).not.toContain('secret');
        expect(open(payload, good)).toEqual({ id: 'n1', secret: 'x' });
        expect(() => open(payload, bad)).toThrow();
    });

    test('private records are stored by scope+lens+key, listed by prefix, and never exported', async () => {
        const adapter = createMemoryAdapter({ retain: true });
        const store = createStore({ appName: APP, adapter });
        await store.open();
        const key = await deriveKey('pw', 'App:h1');
        store.privatePut('App:h1', 'notes', 'n1', seal({ id: 'n1', v: 1 }, key));
        store.privatePut('App:h1', 'notes', 'n2', seal({ id: 'n2', v: 2 }, key));
        store.privatePut('App:h1', 'other', 'o1', seal({ id: 'o1' }, key));
        store.privatePut('App:h2', 'notes', 'n9', seal({ id: 'n9' }, key));

        expect(store.privateList('App:h1', 'notes').map((r) => r.key).sort()).toEqual(['n1', 'n2']);
        expect(open(store.privateGet('App:h1', 'notes', 'n2'), key).v).toBe(2);
        expect(store.exportEvents()).toEqual([]);
        expect(store.listHolons()).toEqual([]);

        expect(store.privateDelete('App:h1', 'notes', 'n1')).toBe(true);
        expect(store.privateDelete('App:h1', 'notes', 'n1')).toBe(false);
        expect(store.privateClear('App:h1', 'notes')).toBe(1);
        expect(store.privateList('App:h1', 'notes')).toEqual([]);
        expect(store.privateList('App:h1', 'other')).toHaveLength(1);
        await store.close();

        const again = createStore({ appName: APP, adapter });
        await again.open();
        expect(again.privateList('App:h1', 'other')).toHaveLength(1);
        expect(again.privateList('App:h2', 'notes')).toHaveLength(1);
        await again.close();
    });
});
