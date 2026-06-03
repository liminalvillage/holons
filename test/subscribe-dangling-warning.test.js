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

import HoloSphere from '../holosphere.js';

const APP = 'test-subscribe-dangling';

// Same pattern the web app's janitor parses — the warning must satisfy it.
const JANITOR_PATTERN =
    /^Hologram at ([^/]+)\/([^/]+)\/([^ ]+) did not resolve \(soul=([^)]+)\); skipping\.$/;

describe('subscribe emits a janitor-parseable warning for unresolved holograms', () => {
    let hs;
    const holon = 'sub-dangle-holon';
    const lens = 'quests';

    beforeEach(async () => {
        hs = new HoloSphere(APP, false);
        try { await hs.deleteAll(holon, lens); } catch {}
        await new Promise(r => setTimeout(r, 200));
    }, 30000);

    afterEach(async () => {
        if (hs) await hs.close();
    }, 30000);

    test('unresolved hologram on the subscribe path logs "Hologram at h/l/k did not resolve"', async () => {
        // Force the failure deterministically (and avoid the awaitNetwork
        // deadline wait): the soul itself is irrelevant once resolution
        // returns null — what matters is the warning carries the LOCAL coords.
        const origResolve = hs.resolveHologram.bind(hs);
        hs.resolveHologram = async () => null;

        const warnings = [];
        const origWarn = console.warn;
        console.warn = (...args) => { if (typeof args[0] === 'string') warnings.push(args[0]); };

        try {
            const sub = hs.subscribe(holon, lens, () => { /* consumer ignores */ });

            // Inject a bare hologram pointer at holon/lens/key. We can't use
            // `put` (it would register/rewrite); write the stored shape the
            // wire delivers for a federated pointer directly.
            const key = 'dangling-1';
            const soul = `${APP}/source-holon/quests/${key}`;
            hs.gun.get(APP).get(holon).get(lens).get(key)
                .put(JSON.stringify({ id: key, soul }));

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
            hs.resolveHologram = origResolve;
        }
    }, 15000);
});
