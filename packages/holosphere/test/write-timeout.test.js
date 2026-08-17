// Regression: `put` and `putGlobal`'s underlying `dataPath.put(payload, ack)`
// callback never fires when no peer acknowledges (cold start, offline,
// partitioned mesh). Consumers used to wrap every save in their own
// `Promise.race(setTimeout(reject, N))` — now the library owns it, the
// same way the read paths do (see read-timeout.test.js).

import { testSphere, cleanupTestEnv } from './helpers/testenv.js';

const APP = 'test-write-timeout';

// Gun chain stub that never invokes the put callback. Other methods are
// stubbed minimally so the pre-write read inside `put()` (it checks for an
// existing hologram at the path before writing) resolves to "no data".
function makeNeverAckGunStub() {
    const stub = {};
    stub.get = () => stub;
    stub.put = () => { /* swallow ack callback */ };
    // The pre-write hologram check uses `.once()` via onceWithTimeout —
    // fire immediately with undefined so it resolves quickly to null.
    stub.once = (cb) => { if (cb) setTimeout(() => cb(undefined), 0); };
    stub.on = () => {};
    stub.off = () => {};
    stub.map = () => stub;
    stub.set = () => stub;
    // Some code paths probe `.back` / `_` chain bits — return self to keep
    // the chain alive defensively.
    stub.back = () => stub;
    return stub;
}

describe('write-path timeout', () => {
    let hs;

    afterAll(cleanupTestEnv, 30000);

    beforeEach(async () => {
        hs = await testSphere(APP);
        await new Promise(r => setTimeout(r, 100));
    }, 30000);

    afterEach(async () => {
        if (hs) await hs.close();
    }, 30000);

    test('put resolves with queued:true when Gun ack never fires', async () => {
        hs.gun = makeNeverAckGunStub();

        const start = Date.now();
        const result = await hs.put('h', 'lens', { id: 'x', v: 1 }, { timeout: 500 });
        const elapsed = Date.now() - start;

        expect(result).toBeTruthy();
        expect(result.success).toBe(true);
        expect(result.queued).toBe(true);
        expect(result.pathHolon).toBe('h');
        expect(result.pathLens).toBe('lens');
        expect(result.pathKey).toBe('x');
        // Bounded by the configured 500ms timeout — must not hang.
        expect(elapsed).toBeGreaterThanOrEqual(450);
        expect(elapsed).toBeLessThan(3000);
    }, 10000);

    test('writeGlobal resolves within deadline when Gun ack never fires', async () => {
        hs.gun = makeNeverAckGunStub();

        const start = Date.now();
        const result = await hs.writeGlobal('some_table', { id: 'x', v: 1 }, { timeout: 500 });
        const elapsed = Date.now() - start;

        // writeGlobal's public contract is Promise<void> — we just need to
        // confirm it resolved without hanging.
        expect(result).toBeUndefined();
        expect(elapsed).toBeGreaterThanOrEqual(450);
        expect(elapsed).toBeLessThan(3000);
    }, 10000);

    test('put still completes normally against a live local gun (timeout does not fire prematurely)', async () => {
        // Use the real Gun instance from beforeEach — radisk acks locally,
        // so the put callback fires well before our 5s default deadline.
        const start = Date.now();
        const result = await hs.put('live-holon', 'lens', { id: 'a', v: 1 });
        const elapsed = Date.now() - start;

        expect(result).toBeTruthy();
        expect(result.success).toBe(true);
        // Not queued: the ack arrived.
        expect(result.queued).toBeFalsy();
        expect(elapsed).toBeLessThan(4000);
    }, 15000);
});
