// Regression: the live `subscribe` path must emit the SAME janitor-parseable
// warning that `get`/`getAll` emit when a hologram fails to resolve.
//
// The dashboard reads through `subscribe`, not `getAll`. Before this fix, an
// unresolved hologram on the subscribe path only produced
// `resolveHologram`'s inner "Could not resolve hologram soul: <soul>" log,
// which carries the SOURCE soul but NOT the LOCAL pointer (holon/lens/key).
// A console-hook garbage collector (see the web app's hologramJanitor) needs
// the local coordinates to delete the dead pointer, so dangling pointers
// surfaced via live subscriptions were never cleaned and re-logged forever.
//
// The warning shape `subscribe` must emit, matching get/getAll:
//   Hologram at <holon>/<lens>/<key> did not resolve (soul=<soul>); skipping.

import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

const APP = 'test-subscribe-dangling';

// Same pattern the web app's janitor parses — the warning must satisfy it.
const JANITOR_PATTERN =
    /^Hologram at ([^/]+)\/([^/]+)\/([^ ]+) did not resolve \(soul=([^)]+)\); skipping\.$/;

describe('subscribe emits a janitor-parseable warning for unresolved holograms', () => {
    let hs;
    const holon = 'sub-dangle-holon';
    const lens = 'quests';

    afterAll(cleanupTestEnv, 30000);

    beforeEach(async () => {
        hs = await testSphere(APP);
        try { await hs.deleteAll(holon, lens); } catch {}
        await new Promise(r => setTimeout(r, 200));
    }, 30000);

    afterEach(async () => {
        if (hs) await hs.close();
    }, 30000);

    test('unresolved hologram on the subscribe path logs "Hologram at h/l/k did not resolve"', async () => {
        // Force the failure deterministically (and avoid the awaitNetwork
        // deadline wait): the status is irrelevant once resolution fails —
        // what matters is the warning carries the LOCAL coords. The subscribe
        // path now uses the typed resolver, so stub that (a non-'deleted'
        // failure status takes the transient "skipping" branch).
        const origResolve = hs.resolveHologramDetailed.bind(hs);
        hs.resolveHologramDetailed = async () => ({ status: 'unresolved', data: null, soul: null, reason: 'stub' });

        const warnings = [];
        const origWarn = console.warn;
        console.warn = (...args) => { if (typeof args[0] === 'string') warnings.push(args[0]); };

        try {
            const sub = hs.subscribe(holon, lens, () => { /* consumer ignores */ });

            // Inject a bare hologram pointer at holon/lens/key straight into
            // the store, the shape the wire delivers for a federated pointer.
            const key = 'dangling-1';
            const soul = `${APP}/source-holon/quests/${key}`;
            hs.store.putRaw(holon, lens, key, { id: key, soul });

            await new Promise(r => setTimeout(r, 800));
            sub.unsubscribe();

            const match = warnings
                .map((w) => JANITOR_PATTERN.exec(w))
                .find(Boolean);

            expect(match).toBeTruthy();
            expect(match[1]).toBe(holon);  // local pointer holon
            expect(match[2]).toBe(lens);   // local pointer lens
            expect(match[3]).toBe(key);    // local pointer key
            expect(match[4]).toBe(soul);   // source soul
        } finally {
            console.warn = origWarn;
            hs.resolveHologramDetailed = origResolve;
        }
    }, 15000);
});
