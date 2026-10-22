/**
 * A lens can be carried on two wires, and each keeps its own sync cursor.
 *
 * The scenario that forces this: a lens has been synced on the kind-30078
 * envelope for a long time, so its cursor sits at "now". Later the lens gains a
 * standard-kind wire whose history on the relay is OLDER than that. One shared
 * cursor would catch that new wire up from the envelope's `since` and skip
 * every event before it — silently, and permanently, because the cursor only
 * moves forward.
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { SimplePool } from 'nostr-tools/pool';
import { buildEvent, generateSecretKey, getPublicKey } from '../nostr-events.js';
import { createWireRegistry, decodeEvent } from '../store/index.js';
import { testSphere, startLocalRelay, cleanupTestEnv, waitFor } from './helpers/testenv.js';

const APP = 'per-wire-cursor-test';
const HOLON = 'wire-holon';
const LENS = 'tasks';
const OCC = 31923;

/** A wire that claims kind 31923 for this lens, reusing the envelope grammar. */
const standardWire = () => {
    const wire = createWireRegistry();
    wire.register({
        lens: LENS,
        kinds: [OCC],
        decode: (e) => { const d = decodeEvent(e); return d ? [d] : null; },
        filters: (holon) => [{ kinds: [OCC], '#h': [holon], '#l': [LENS], '#n': [APP] }],
    });
    return wire;
};

describe('sync cursors are per wire, not per lens', () => {
    let relay;
    let dir;
    const pool = new SimplePool();

    beforeAll(async () => { relay = await startLocalRelay(); });
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-wire-')); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
    afterAll(async () => {
        try { pool.close([relay.url]); } catch { /* ignore */ }
        await cleanupTestEnv();
    });

    test('a lens warm on the envelope still backfills a wire it has never carried', async () => {
        const now = Math.floor(Date.now() / 1000);
        const sk = generateSecretKey();
        // Under enforce the reader only surfaces authors on its read-list, so
        // the publisher of the standard-kind history has to be on it.
        const readKeys = [getPublicKey(sk)];

        // Standard-kind history, an hour older than anything on the envelope.
        for (const id of ['s1', 's2', 's3']) {
            const evt = buildEvent({
                holon: HOLON, lens: LENS, item: { id, title: `standard ${id}` },
                sk, created_at: now - 3600, kind: OCC, extraTags: [['n', APP]],
            });
            await Promise.any(pool.publish([relay.url], evt));
        }
        // Envelope history, at "now".
        const writer = await testSphere(APP, { relays: [relay.url] });
        for (const id of ['e1', 'e2']) await writer.put(HOLON, LENS, { id, title: `envelope ${id}` });

        // 1. A reader that only knows the envelope. Its cursor lands at "now".
        const r1 = await testSphere(APP, { relays: [relay.url], store: { adapter: 'file', dir }, signing: { readKeys } });
        await waitFor(async () => (await r1.getAll(HOLON, LENS)).length >= 2);
        expect(await r1.getAll(HOLON, LENS)).toHaveLength(2);
        expect(r1.store.getCursor(HOLON, LENS)?.since).toBeGreaterThanOrEqual(now);
        expect(r1.store.getCursor(HOLON, LENS, `std:${OCC}`)).toBeNull();
        await r1.close?.();

        // 2. The same store, reopened knowing the standard wire too. The
        //    envelope cursor persists; the standard wire has none, so it
        //    backfills — and reaches events an hour older than that cursor.
        const r2 = await testSphere(APP, {
            relays: [relay.url],
            store: { adapter: 'file', dir, wire: standardWire() },
            signing: { readKeys },
        });
        await waitFor(async () => (await r2.getAll(HOLON, LENS)).length >= 5);

        const ids = (await r2.getAll(HOLON, LENS)).map((i) => i.id).sort();
        expect(ids).toEqual(['e1', 'e2', 's1', 's2', 's3']);
        expect(r2.store.getCursor(HOLON, LENS, `std:${OCC}`)?.since).toBeGreaterThan(0);
    }, 30000);
});
