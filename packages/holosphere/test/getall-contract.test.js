// Lock in the `holosphere.getAll` return-shape contract:
// **Always resolves to `Array<T>`** — never null, never an object map, never
// a string, never a single-char from a stringified-item glitch. Every consumer
// (web dashboard, telegram bot, MCP server) relies on this so they can
// drop the historical `ensureArray(...) / Array.isArray(...) ? ... :
// Object.values(...)` defensive code.

import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

const APP = 'test-getall-contract';

describe('getAll return-shape contract', () => {
    let hs;
    const holon = 'getall-contract-holon';
    const lens = 'items';

    afterAll(cleanupTestEnv, 30000);

    beforeEach(async () => {
        hs = await testSphere(APP);
        // Clean slate per test so empty/populated cases don't bleed.
        try { await hs.deleteAll(holon, lens); } catch {}
        await new Promise(r => setTimeout(r, 200));
    }, 30000);

    afterEach(async () => {
        if (hs) await hs.close();
    }, 30000);

    test('empty lens resolves to []', async () => {
        const result = await hs.getAll(holon, lens);
        expect(Array.isArray(result)).toBe(true);
        expect(result).toEqual([]);
    }, 10000);

    test('populated lens resolves to an array of the records', async () => {
        await hs.put(holon, lens, { id: 'a', value: 1 });
        await hs.put(holon, lens, { id: 'b', value: 2 });
        await hs.put(holon, lens, { id: 'c', value: 3 });
        await new Promise(r => setTimeout(r, 400));

        const result = await hs.getAll(holon, lens);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(3);
        // Order is not guaranteed; check by id.
        const ids = result.map(r => r.id).sort();
        expect(ids).toEqual(['a', 'b', 'c']);
    }, 15000);

    test('after a delete, the remaining records still come back as an array', async () => {
        await hs.put(holon, lens, { id: 'keep', value: 'me' });
        await hs.put(holon, lens, { id: 'gone', value: 'bye' });
        await new Promise(r => setTimeout(r, 300));

        await hs.delete(holon, lens, 'gone');
        await new Promise(r => setTimeout(r, 300));

        const result = await hs.getAll(holon, lens);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(1);
        expect(result[0].id).toBe('keep');
    }, 15000);

    test('never returns null even when the holon has never been written to', async () => {
        const result = await hs.getAll('never-touched-holon-xyz', 'never-touched-lens-xyz');
        expect(result).not.toBeNull();
        expect(Array.isArray(result)).toBe(true);
        expect(result).toEqual([]);
    }, 10000);
});
