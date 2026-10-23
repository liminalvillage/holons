/**
 * A received event dated far ahead of this clock is refused: `created_at`
 * decides last-writer-wins and caps every field-clock stamp, so one event
 * dated next year would outrank every honest write until then — and, before
 * the sync cursor learned to follow only accounted events, drag the lens's
 * cursor past all history published in between.
 */
import { SimplePool } from 'nostr-tools/pool';
import { Store, MAX_FUTURE_SKEW } from '../store/store.js';
import { createMemoryAdapter } from '../store/adapters/memory.js';
import { buildEvent, generateSecretKey } from '../nostr-events.js';
import { testSphere, startLocalRelay, cleanupTestEnv, waitFor } from './helpers/testenv.js';

const APP = 'future-skew-test';
const HOLON = 'skew-holon';
const LENS = 'tasks';
const now = () => Math.floor(Date.now() / 1000);
const event = (item, created_at, sk = generateSecretKey()) =>
    buildEvent({ holon: HOLON, lens: LENS, item, sk, created_at, extraTags: [['n', APP]] });

describe('store: future-dated events', () => {
    const open = (opts) => new Store({ appName: APP, adapter: createMemoryAdapter(), ...opts }).open();

    test('a received event dated past the skew bound is refused and not kept', async () => {
        const store = await open();
        const far = event({ id: 'q', when: 'forever' }, now() + MAX_FUTURE_SKEW + 3600);
        expect(store.apply(far, { origin: 'remote' })).toMatchObject({ applied: false, reason: 'future' });
        expect(store.get(HOLON, LENS, 'q')).toBeUndefined();
        expect(store.getEvents(HOLON, LENS, 'q')).toEqual([]);
    });

    test('within the bound is ordinary clock skew', async () => {
        const store = await open();
        expect(store.apply(event({ id: 'q' }, now() + 60), { origin: 'remote' }).applied).toBe(true);
    });

    test('our own writes are exempt: a same-second burst legitimately runs ahead', async () => {
        const store = await open();
        expect(store.apply(event({ id: 'q' }, now() + MAX_FUTURE_SKEW + 60), { origin: 'local' }).applied).toBe(true);
    });

    test('the bound is configurable', async () => {
        const store = await open({ maxFutureSkew: 10 });
        expect(store.apply(event({ id: 'q' }, now() + 60), { origin: 'remote' }).reason).toBe('future');
    });
});

describe('transport: a refused event does not move the sync cursor', () => {
    let relay;
    const pool = new SimplePool();

    beforeAll(async () => { relay = await startLocalRelay(); });
    afterAll(async () => {
        try { pool.close([relay.url]); } catch { /* ignore */ }
        await cleanupTestEnv();
    });

    test('backfill keeps the cursor at the newest accounted event', async () => {
        const t = now();
        const sk = generateSecretKey();
        await Promise.any(pool.publish([relay.url], event({ id: 'ok', title: 'honest' }, t - 60, sk)));
        await Promise.any(pool.publish([relay.url], event({ id: 'far', title: 'next year' }, t + 365 * 86400, sk)));

        const reader = await testSphere(APP, { relays: [relay.url] });
        await reader.getAll(HOLON, LENS);
        await waitFor(() => !!reader.store.getCursor(HOLON, LENS));

        expect(reader.store.get(HOLON, LENS, 'ok')).toBeTruthy();
        expect(reader.store.get(HOLON, LENS, 'far')).toBeUndefined();
        expect(reader.store.getCursor(HOLON, LENS).since).toBeLessThanOrEqual(now());
    }, 30000);
});
