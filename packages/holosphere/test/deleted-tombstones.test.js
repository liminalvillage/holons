// `_deleted: true` is the soft-tombstone convention used by the bot, the
// web dashboard, and the MCP council tools. Before this fix the library
// was unaware of it and every reader had to filter out tombstones
// defensively. Now `get` returns `null` and `getAll` skips them by
// default; consumers wanting tombstones (admin/debug, history
// reconstruction) pass `{ includeDeleted: true }`.

import HoloSphere from '../holosphere.js';

const APP = 'test-deleted-tombstones';

describe('_deleted: true soft-tombstone filtering', () => {
    let hs;
    const holon = 'tombstone-holon';
    const lens = 'items';

    beforeEach(async () => {
        hs = new HoloSphere(APP, false);
        try { await hs.deleteAll(holon, lens); } catch {}
        await new Promise(r => setTimeout(r, 200));
    }, 30000);

    afterEach(async () => {
        if (hs) await hs.close();
    }, 30000);

    test('getAll drops tombstones from the default response', async () => {
        await hs.put(holon, lens, { id: 'alive', value: 'here' });
        await hs.put(holon, lens, { id: 'tombstone', value: 'gone', _deleted: true });
        await new Promise(r => setTimeout(r, 400));

        const items = await hs.getAll(holon, lens);
        const ids = items.map(i => i.id).sort();
        expect(ids).toEqual(['alive']);
    }, 15000);

    test('getAll surfaces tombstones with includeDeleted: true', async () => {
        await hs.put(holon, lens, { id: 'alive', value: 'here' });
        await hs.put(holon, lens, { id: 'tombstone', value: 'gone', _deleted: true });
        await new Promise(r => setTimeout(r, 400));

        const items = await hs.getAll(holon, lens, null, { includeDeleted: true });
        const ids = items.map(i => i.id).sort();
        expect(ids).toEqual(['alive', 'tombstone']);
        const ts = items.find(i => i.id === 'tombstone');
        expect(ts._deleted).toBe(true);
    }, 15000);

    test('get returns null for tombstoned records by default', async () => {
        await hs.put(holon, lens, { id: 'gone', value: 'x', _deleted: true });
        await new Promise(r => setTimeout(r, 300));

        const result = await hs.get(holon, lens, 'gone');
        expect(result).toBeNull();
    }, 15000);

    test('get surfaces tombstoned records with includeDeleted: true', async () => {
        await hs.put(holon, lens, { id: 'gone', value: 'x', _deleted: true });
        await new Promise(r => setTimeout(r, 300));

        const result = await hs.get(holon, lens, 'gone', null, { includeDeleted: true });
        expect(result).not.toBeNull();
        expect(result.id).toBe('gone');
        expect(result._deleted).toBe(true);
    }, 15000);
});
