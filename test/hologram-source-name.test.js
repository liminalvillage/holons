// Regression: `resolveHologram` must stamp `_hologram.sourceHolonName`
// so consumers of `get` / `getAll` / `subscribe` / `getFederated` all see
// the source holon's display name without having to fetch
// `settings/<holon>` themselves. The bot used to do this lookup in
// `preResolveHologramNames` — now the library owns it.

import HoloSphere from '../holosphere.js';

const APP = 'test-source-holon-name';

describe('resolveHologram stamps sourceHolonName', () => {
    let hs;

    beforeEach(async () => {
        hs = new HoloSphere(APP, false);
        await new Promise(r => setTimeout(r, 200));
    }, 30000);

    afterEach(async () => {
        if (hs) await hs.close();
    }, 30000);

    test('get() on a hologram pointer stamps the source holon name', async () => {
        const sourceHolon = 'source-holon-x';
        const consumerHolon = 'consumer-holon-y';
        // Source holon has a name and the original record.
        await hs.put(sourceHolon, 'settings', { id: sourceHolon, name: 'Source Garden' });
        await hs.put(sourceHolon, 'quests', { id: 'q1', title: 'Plant tomatoes' });
        // Consumer holon stores a hologram pointing at the source.
        await hs.put(consumerHolon, 'quests', { id: 'q1', soul: `${APP}/${sourceHolon}/quests/q1` });
        await new Promise(r => setTimeout(r, 500));

        const resolved = await hs.get(consumerHolon, 'quests', 'q1');
        expect(resolved).not.toBeNull();
        expect(resolved.title).toBe('Plant tomatoes'); // resolved-through
        expect(resolved._hologram).toBeDefined();
        expect(resolved._hologram.sourceHolon).toBe(sourceHolon);
        expect(resolved._hologram.sourceHolonName).toBe('Source Garden');
    }, 15000);

    test('source-name lookup is cached (one fetch per holon, not per hologram)', async () => {
        const sourceHolon = 'source-cached';
        const consumerHolon = 'consumer-cached';
        await hs.put(sourceHolon, 'settings', { id: sourceHolon, name: 'Cached Source' });
        await hs.put(sourceHolon, 'items', { id: 'a', value: 'A' });
        await hs.put(sourceHolon, 'items', { id: 'b', value: 'B' });
        await hs.put(consumerHolon, 'items', { id: 'a', soul: `${APP}/${sourceHolon}/items/a` });
        await hs.put(consumerHolon, 'items', { id: 'b', soul: `${APP}/${sourceHolon}/items/b` });
        await new Promise(r => setTimeout(r, 500));

        // Warm the cache.
        hs._holonNameCache.clear();
        const items = await hs.getAll(consumerHolon, 'items');
        expect(items.length).toBe(2);
        for (const item of items) {
            expect(item._hologram?.sourceHolonName).toBe('Cached Source');
        }
        // The cache should have exactly one entry for the source holon.
        expect(hs._holonNameCache.get(sourceHolon)).toBe('Cached Source');
    }, 15000);
});
