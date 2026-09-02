/**
 * LIVE relay round-trip: sign-on-write publishes to a real Nostr relay and a
 * fresh, empty node recovers the data from that relay alone (`rehydrate`).
 *
 * Opt-in only: runs when HOLO_TEST_RELAYS is set (comma-separated wss:// urls,
 * e.g. HOLO_TEST_RELAYS=wss://relay.holons.io). Without it the suite is
 * skipped, keeping the default run hermetic. Writes use throwaway keys and a
 * clearly test-scoped, non-H3 holon name (an H3 id would fire background
 * parent-propagation timers that outlive the suite).
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { jest } from '@jest/globals';
import HoloSphere from '../holosphere.js';
import { generateSecretKey } from '../nostr-events.js';

jest.setTimeout(120000); // live network round-trips under full-suite load

const RELAYS = (process.env.HOLO_TEST_RELAYS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
const describeWithRelay = RELAYS.length ? describe : describe.skip;

const HOLON = 'holo-test-relay-roundtrip';
const LENS = 'roundtrip';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function tmpGun(dirs) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-live-'));
    dirs.push(dir);
    return { peers: [], axe: false, multicast: false, radisk: true, file: path.join(dir, 'radata'), localStorage: false };
}

describeWithRelay(`live relay round-trip (${RELAYS.join(', ') || 'skipped'})`, () => {
    const dirs = [];
    let writer, reader;
    // Unique per run: kind-30078 events are replaceable per (pubkey, d-tag),
    // and keys are fresh each run, but a unique id keeps runs distinguishable
    // on the shared relay and immune to stale leftovers.
    const itemId = `rt-${Date.now()}-${process.pid}`;

    afterAll(async () => {
        for (const s of [writer, reader]) {
            try { s?.disableSigning(); } catch { /* no signer */ }
            try { await s?.close?.(); } catch { /* already closed */ }
        }
        for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* tmp reaper's problem */ } }
    }, 20000);

    test('a signed put reaches the relay and rehydrates into a fresh empty node', async () => {
        writer = new HoloSphere({ appName: 'relay-live-test', privateKey: generateSecretKey(), store: { adapter: 'memory' } });
        await writer.enableSigning({ relays: RELAYS });
        expect(writer.signingEnabled).toBe(true);

        await writer.put(HOLON, LENS, { id: itemId, title: 'Crossed the wire' });

        // The reader shares nothing with the writer but the relay: fresh key,
        // fresh empty Gun graph. Only the relay can deliver the item.
        reader = new HoloSphere({ appName: 'relay-live-test', privateKey: generateSecretKey(), store: { adapter: 'memory' } });
        await reader.enableSigning({ relays: RELAYS });

        const before = await reader.getAll(HOLON, LENS, null, { _skipAuthorize: true });
        expect(before.find((i) => i.id === itemId)).toBeFalsy();

        // Publish is fire-and-forget — poll rehydrate until the event lands.
        // Under full-suite load (every signed put in every worker publishing to
        // the same relay) a single publish can be dropped or badly delayed, so
        // the writer re-puts periodically: kind-30078 is replaceable per
        // (pubkey, d-tag), making the re-publish idempotent on the relay.
        let found = null;
        const deadline = Date.now() + 90000;
        for (let attempt = 0; !found && Date.now() < deadline; attempt++) {
            await wait(1500);
            if (attempt > 0 && attempt % 4 === 0) {
                await writer.put(HOLON, LENS, { id: itemId, title: 'Crossed the wire' });
            }
            await reader.rehydrate(HOLON, LENS);
            const items = await reader.getAll(HOLON, LENS, null, { _skipAuthorize: true });
            found = items.find((i) => i.id === itemId) || null;
        }
        expect(found?.title).toBe('Crossed the wire');
    });
});
