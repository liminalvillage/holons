// Regression: cross-holon hologram soul resolution must not be fooled by
// Gun's `.once()` firing a synchronous `undefined` for a COLD node.
//
// `.once()` returns whatever is in the LOCAL graph right now and never
// re-fires. A hologram soul points at another holon's lens this peer never
// subscribed to, so the node is cold — `.once()` fires `undefined`, the real
// value arrives from a peer a few ms later, and the old read path had already
// concluded `null` and logged `Could not resolve hologram soul: … (target not
// present locally)`. The data was there the whole time.
//
// The fix: `get`/`resolveHologram` read the soul in `awaitNetwork` mode, which
// uses `.on()` — skipping the cold `undefined` and settling once the value
// syncs, while still honouring an explicit `null` tombstone and the deadline.
// The default same-holon read path keeps the fast `.once()` behaviour, so this
// also pins that there is NO latency regression for ordinary missing reads.

import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

const APP = 'test-cold-soul';

// Gun chain stub. `.once()` always fires `undefined` (cold local cache).
// `.on()` fires `undefined` first, then — for keys present in `payloads` —
// delivers the real value after `syncDelay` ms, emulating a peer answering.
function makeColdThenSyncGun(payloads, { syncDelay = 25 } = {}) {
    let lastKey = null;
    const node = {
        get(k) { lastKey = k; return node; },
        map() { return node; },
        once(cb) {
            const key = lastKey;
            if (cb) setTimeout(() => cb(undefined, key), 0); // cold: nothing local
        },
        on(cb) {
            const key = lastKey;
            if (!cb) return node;
            setTimeout(() => cb(undefined, key), 0); // cold first
            if (Object.prototype.hasOwnProperty.call(payloads, key)) {
                setTimeout(() => cb(payloads[key], key), syncDelay); // peer answers
            }
            return node;
        },
        off() { return node; },
        back() { return node; },
        put() { return node; },
        set() { return node; },
        user() { return node; },
    };
    return node;
}

describe('cold cross-holon soul resolution', () => {
    let hs;

    afterAll(cleanupTestEnv, 30000);

    beforeEach(async () => {
        hs = testSphere(APP);
        await new Promise(r => setTimeout(r, 100));
    }, 30000);

    afterEach(async () => {
        if (hs) await hs.close();
    }, 30000);

    test('resolveHologram returns the value when the cold soul syncs after the initial undefined', async () => {
        const key = 'quest-cold-1';
        const quest = { id: key, title: 'present after sync', description: '' };
        hs.gun = makeColdThenSyncGun({ [key]: JSON.stringify(quest) });

        const soul = `${APP}/source-holon/quests/${key}`;
        const resolved = await hs.resolveHologram({ id: key, soul });

        expect(resolved).toBeTruthy();
        expect(resolved.title).toBe('present after sync');
        // Carries the canonical resolved-hologram envelope.
        expect(resolved._hologram?.soul).toBe(soul);
        expect(resolved._hologram?.sourceHolon).toBe('source-holon');
    }, 15000);

    test('awaitNetwork get waits past the cold undefined and returns the data', async () => {
        const key = 'k-await';
        const payload = { id: key, value: 42 };
        hs.gun = makeColdThenSyncGun({ [key]: JSON.stringify(payload) });

        const v = await hs.get('source-holon', 'items', key, null, { awaitNetwork: true, timeout: 2000 });
        expect(v).toBeTruthy();
        expect(v.value).toBe(42);
    }, 15000);

    test('default get (no awaitNetwork) still fast-fails to null on a cold undefined', async () => {
        // No payload for this key, and crucially we assert the FAST path: the
        // default read accepts the synchronous `undefined` and returns null
        // long before any deadline — the empty/missing same-holon case must
        // not pay the awaitNetwork wait.
        hs.gun = makeColdThenSyncGun({});

        const start = Date.now();
        const v = await hs.get('source-holon', 'items', 'missing-key', null, { timeout: 5000 });
        const elapsed = Date.now() - start;

        expect(v).toBeNull();
        expect(elapsed).toBeLessThan(500); // resolved on the immediate .once(), not the 5s deadline
    }, 15000);

    test('awaitNetwork get is deadline-bounded when no peer ever answers', async () => {
        hs.gun = makeColdThenSyncGun({}); // .on only ever fires undefined for this key

        const start = Date.now();
        const v = await hs.get('source-holon', 'items', 'never-answers', null, { awaitNetwork: true, timeout: 600 });
        const elapsed = Date.now() - start;

        expect(v).toBeNull();
        expect(elapsed).toBeGreaterThanOrEqual(550);
        expect(elapsed).toBeLessThan(3000);
    }, 15000);
});
