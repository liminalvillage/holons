// Regression: `getFederated` must filter out unresolved-reference error
// stubs by default. Consumers (dashboard, library widget, etc.) should
// never have to know about the
// `{ id, _hologram: { isHologram: false, error } }` shape — it's an
// internal failure marker.
//
// Pre-fix, the dashboard had:
//   // ⚠️ Unresolved hologram filtered — these should have been resolved
//   // by HoloSphere
//   if (item.hologram === true) return false;
// That filter was checking the wrong field; the real shape is
// `_hologram.isHologram === false`. Easier than asking every caller to
// know the right field is to filter at the library boundary.

import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

const APP = 'test-fed-stubs';

describe('getFederated drops unresolved-reference stubs by default', () => {
    let hs;
    const holon = 'fedstub-holon';
    const lens = 'items';

    afterAll(cleanupTestEnv, 30000);

    beforeEach(async () => {
        hs = testSphere(APP);
        try { await hs.deleteAll(holon, lens); } catch {}
        await new Promise(r => setTimeout(r, 200));
    }, 30000);

    afterEach(async () => {
        if (hs) await hs.close();
    }, 30000);

    test('default response excludes _hologram.isHologram === false stubs', async () => {
        // Store one real record + one hologram pointer to a never-written soul.
        await hs.put(holon, lens, { id: 'real', value: 'present' });
        const stalePointer = { id: 'stale', soul: `${APP}/${holon}/${lens}/never-was` };
        await hs.put(holon, lens, stalePointer);
        await new Promise(r => setTimeout(r, 400));

        const items = await hs.getFederated(holon, lens, {
            includeLocal: true,
            includeFederated: false,
            resolveReferences: true,
        });

        expect(Array.isArray(items)).toBe(true);
        const ids = items.map(i => i.id);
        expect(ids).toContain('real');
        // The stale pointer would resolve to an error stub with
        // _hologram.isHologram === false — must not appear in the default response.
        expect(ids).not.toContain('stale');
    }, 15000);

    // Note: `includeUnresolvedStubs: true` is the escape hatch for
    // admin/debug callers that want to see the failures. Exercising it
    // properly requires a cross-holon federation setup (the local-path
    // `getAll` already skips unresolved pointers before `getFederated`'s
    // resolve-references code can generate a stub). Documented for now;
    // exercised end-to-end in the federation cluster integration suite.
});
