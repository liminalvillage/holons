// Sealed envelopes through the store: locked stubs without a key, plaintext
// with an unsealer, in-place flips on `rescan`, and the `keys` table.
import { createStore, createMemoryAdapter, isLocked, sealed as S } from '../../store/index.js';
import { APP, keypair, signed, tick } from './helpers.js';

const { generateKey, sealItem, unsealItem, kidOf } = S;

function sealedEvent({ item, sk, lensKey, cek, created_at, holon = 'h1', lens = 'quests' }) {
    const payload = sealItem(item, { cek, lensKey });
    // The envelope: same tags as a plaintext write, only the content differs.
    const evt = signed({ holon, lens, item: { id: item.id }, sk, created_at });
    return { ...evt, content: JSON.stringify(payload), payload };
}

// Re-sign an envelope whose content we swapped (buildEvent signs the item).
import { finalizeEvent } from 'nostr-tools/pure';
function resigned(evt, sk) {
    const { id: _i, sig: _s, pubkey: _p, payload, ...tmpl } = evt;
    return { ...finalizeEvent(tmpl, sk), payload };
}

describe('store: sealed content', () => {
    const lensKey = generateKey();
    const unsealWith = (key) => ({ sealed }) => {
        try { return unsealItem(sealed, { lensKey: key }); } catch { return null; }
    };

    test('without a key a sealed event lands as a locked stub, hidden from list() and watch replay', async () => {
        const store = createStore({ appName: APP, adapter: 'memory' });
        await store.open();
        const { sk } = keypair();
        const evt = resigned(sealedEvent({ item: { id: 'q1', title: 'hidden' }, sk, lensKey, cek: generateKey(), created_at: 100 }), sk);
        const r = store.apply(evt);
        expect(r.applied).toBe(true);
        const rec = store.get('h1', 'quests', 'q1');
        expect(isLocked(rec.item)).toBe(true);
        expect(rec.item).toEqual({ id: 'q1', _locked: true, _kid: kidOf(lensKey) });
        expect(JSON.stringify(rec)).not.toContain('hidden');
        expect(store.list('h1', 'quests')).toEqual([]);
        expect(store.list('h1', 'quests', { includeLocked: true }).map((x) => x.id)).toEqual(['q1']);
        const seen = [];
        store.watch('h1', 'quests', (item, id) => seen.push(id));
        await tick();
        expect(seen).toEqual([]);
        await store.close();
    });

    test('with an unsealer the item is plaintext; a payload sealed for another id is not a claim', async () => {
        const store = createStore({ appName: APP, adapter: 'memory', unseal: unsealWith(lensKey) });
        await store.open();
        const { sk } = keypair();
        const evt = resigned(sealedEvent({ item: { id: 'q1', title: 'open' }, sk, lensKey, cek: generateKey(), created_at: 100 }), sk);
        expect(store.apply(evt).applied).toBe(true);
        expect(store.get('h1', 'quests', 'q1').item).toEqual({ id: 'q1', title: 'open' });
        // Same ciphertext re-addressed at q2 (a replay attack on another address).
        const forged = resigned({ ...evt, tags: evt.tags.map((t) => (t[0] === 'd' ? ['d', 'h1/quests/q2'] : t)) }, sk);
        expect(store.apply(forged)).toMatchObject({ applied: false, reason: 'malformed' });
        expect(store.get('h1', 'quests', 'q2')).toBeUndefined();
        await store.close();
    });

    test('a locked stub supersedes an older plaintext record at the same address', async () => {
        const store = createStore({ appName: APP, adapter: 'memory' });
        await store.open();
        const { sk } = keypair();
        store.apply(signed({ holon: 'h1', lens: 'quests', item: { id: 'q1', title: 'was public' }, sk, created_at: 100 }));
        const evt = resigned(sealedEvent({ item: { id: 'q1', title: 'now private' }, sk, lensKey, cek: generateKey(), created_at: 200 }), sk);
        store.apply(evt);
        expect(isLocked(store.get('h1', 'quests', 'q1').item)).toBe(true);
        expect(store.list('h1', 'quests')).toEqual([]);
        await store.close();
    });

    test('rescan flips stubs open when a key arrives, and locks them again when it goes; watchers hear both', async () => {
        const store = createStore({ appName: APP, adapter: 'memory' });
        await store.open();
        const { sk } = keypair();
        const evt = resigned(sealedEvent({ item: { id: 'q1', title: 'late key' }, sk, lensKey, cek: generateKey(), created_at: 100 }), sk);
        store.apply(evt);
        const other = resigned(sealedEvent({ item: { id: 'r1', title: 'other lens' }, sk, lensKey, cek: generateKey(), created_at: 100, lens: 'roles' }), sk);
        store.apply(other);
        const heard = [];
        store.watch('h1', 'quests', (item, id, meta) => heard.push({ id, locked: meta.locked, title: item.title }));
        await tick();
        expect(heard).toEqual([]);

        store.setUnseal(unsealWith(lensKey));
        expect(store.rescan({ holon: 'h1', lens: 'quests' })).toBe(1);
        expect(store.get('h1', 'quests', 'q1').item).toEqual({ id: 'q1', title: 'late key' });
        expect(isLocked(store.get('h1', 'roles', 'r1').item)).toBe(true);   // other lens untouched
        expect(store.rescan()).toBe(1);                                      // now the rest
        expect(store.get('h1', 'roles', 'r1').item.title).toBe('other lens');
        expect(store.rescan()).toBe(0);                                      // idempotent

        store.setUnseal(null);
        expect(store.rescan()).toBe(2);
        expect(isLocked(store.get('h1', 'quests', 'q1').item)).toBe(true);
        expect(heard).toEqual([
            { id: 'q1', locked: false, title: 'late key' },
            { id: 'q1', locked: true, title: undefined },
        ]);
        await store.close();
    });

    test('a wrong key leaves the stub; the winning event is what rescan re-reads', async () => {
        const store = createStore({ appName: APP, adapter: 'memory', unseal: unsealWith(generateKey()) });
        await store.open();
        const { sk } = keypair();
        store.apply(resigned(sealedEvent({ item: { id: 'q1', title: 'x' }, sk, lensKey, cek: generateKey(), created_at: 100 }), sk));
        expect(isLocked(store.get('h1', 'quests', 'q1').item)).toBe(true);
        expect(store.rescan()).toBe(0);
        await store.close();
    });

    test('keys table persists and hydrates like the private table', async () => {
        const adapter = createMemoryAdapter({ retain: true });
        const s1 = createStore({ appName: APP, adapter });
        await s1.open();
        s1.keysPut('app|owner|h1|quests|abc', 'cipher-1');
        s1.keysPut('app|owner|h1|roles|def', 'cipher-2');
        s1.keysPut('app|other|h2|quests|ghi', 'cipher-3');
        expect(s1.keysGet('app|owner|h1|quests|abc')).toBe('cipher-1');
        expect(s1.keysList('app|owner|').map((r) => r.key).sort()).toEqual(['app|owner|h1|quests|abc', 'app|owner|h1|roles|def']);
        expect(s1.keysDelete('app|owner|h1|roles|def')).toBe(true);
        expect(s1.keysDelete('nope')).toBe(false);
        expect(s1.stats().keys).toBe(2);
        await s1.close();
        const s2 = createStore({ appName: APP, adapter });
        await s2.open();
        expect(s2.keysList().map((r) => r.key).sort()).toEqual(['app|other|h2|quests|ghi', 'app|owner|h1|quests|abc']);
        expect(s2.snapshot().keys).toHaveLength(2);
        await s2.clear();
        expect(s2.keysList()).toEqual([]);
        await s2.close();
    });
});
