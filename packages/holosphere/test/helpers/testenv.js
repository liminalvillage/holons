// Shared test environment: fully isolated HoloSphere instances.
//
// The old pattern `new HoloSphere(APP, false)` inherited the constructor's
// production defaults — peers: ['https://gun.holons.io/gun'] and a radisk at
// './holosphere' SHARED by every suite and every historical run. Consequences:
// every test run leaked data through the LIVE relay, jest's parallel workers
// raced each other through the shared radisk and multicast, and the set of
// failing suites changed randomly from run to run.
//
// Every suite must build instances through this helper instead: no peers, no
// multicast, and a fresh mkdtemp radisk per instance, so suites are hermetic
// and parallel-safe. Cross-holon behaviour (holograms, federation) lives
// inside ONE Gun graph — a single isolated instance exercises it fully. For
// the rare test that genuinely needs two instances syncing over a wire,
// `startLocalRelay()` boots a throwaway relay on an ephemeral port.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import HoloSphere from '../../holosphere.js';
import Gun from 'gun';
import { generateSecretKey } from '../../nostr-events.js';

const spheres = [];
const dirs = [];
const relays = [];

// HOLO_TEST_SIGNING=shadow|enforce runs every testSphere() with Nostr signing
// enabled (fresh key per sphere, envelopes stored locally, relays: []) so the
// whole suite exercises the signed write path. Unset = today's unsigned path.
//
// HOLO_TEST_RELAYS=wss://… (comma-separated) additionally dual-publishes every
// signed write to real Nostr relay(s). Publishes are fire-and-forget and reads
// stay local, so this exercises live relay connections without making suite
// results depend on relay latency. Only meaningful together with
// HOLO_TEST_SIGNING (or an explicit `signing` option).
const ENV_SIGNING = process.env.HOLO_TEST_SIGNING || '';
const ENV_RELAYS = (process.env.HOLO_TEST_RELAYS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
// Spheres created in this worker so far, for cross-trust wiring: in enforce
// mode every sphere must have every other sphere's pubkey in its read-list or
// multi-instance tests (over startLocalRelay) would drop each other's writes.
const keyring = [];

/** Gun options for one isolated instance (fresh tmp radisk, no network). */
export function isolatedGunOptions(overrides = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-test-'));
    dirs.push(dir);
    return {
        peers: [],
        axe: false,
        multicast: false,
        radisk: true,
        file: path.join(dir, 'radata'),
        localStorage: false,
        ...overrides,
    };
}

/**
 * An isolated HoloSphere (hermetic Gun options). Registered for
 * `cleanupTestEnv()`; pass `gunOptions` to override pieces (e.g.
 * `peers: [relay.url]` from `startLocalRelay`, or a shared `file` for
 * persistence-across-restart tests).
 *
 * Returns the sphere directly on the default unsigned path. With
 * HOLO_TEST_SIGNING (or an explicit `signing: { mode }`) it returns a
 * Promise of the sphere instead — `await testSphere(...)` works in both
 * modes, and every call site awaits.
 */
export function testSphere(appName, { strict = false, gunOptions = {}, signing } = {}) {
    const mode = signing?.mode ?? (ENV_SIGNING || null);
    if (!mode) {
        const sphere = new HoloSphere(appName, strict, null, isolatedGunOptions(gunOptions));
        spheres.push(sphere);
        return sphere;
    }
    if (mode !== 'shadow' && mode !== 'enforce') {
        throw new Error(`testSphere: unknown signing mode '${mode}' (use shadow|enforce)`);
    }
    const sphere = new HoloSphere({
        appName,
        strict,
        privateKey: signing?.privateKey ?? generateSecretKey(),
        gunOptions: isolatedGunOptions(gunOptions),
    });
    spheres.push(sphere);
    return (async () => {
        await sphere.enableSigning({
            relays: signing?.relays ?? ENV_RELAYS,
            ...(mode === 'shadow' ? { shadow: true } : { enforce: true }),
            readKeys: [...keyring.map((k) => k.pub), ...(signing?.readKeys ?? [])],
        });
        if (!sphere.signingEnabled) {
            throw new Error('testSphere: enableSigning resolved without an active signer');
        }
        const pub = sphere.currentPubkey;
        for (const k of keyring) {
            try { await k.sphere.addReadKey(pub); } catch { /* closed sphere */ }
        }
        keyring.push({ sphere, pub });
        return sphere;
    })();
}

/**
 * A throwaway Gun relay on an ephemeral localhost port, with its own tmp
 * radisk. Returns `{ url, close }`; `url` goes straight into an instance's
 * `gunOptions.peers`. Only for tests that MUST sync two instances over a
 * wire — everything else should stay peerless.
 */
export async function startLocalRelay() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-relay-'));
    dirs.push(dir);
    const server = http.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const gun = Gun({
        web: server,
        axe: false,
        multicast: false,
        radisk: true,
        file: path.join(dir, 'radata'),
        localStorage: false,
    });
    const relay = {
        url: `http://127.0.0.1:${port}/gun`,
        close: () =>
            new Promise((resolve) => {
                try { gun.off?.(); } catch { /* best-effort */ }
                server.close(() => resolve());
                // A lingering websocket keeps close() pending; don't let it.
                setTimeout(resolve, 500).unref?.();
            }),
    };
    relays.push(relay);
    return relay;
}

/** Close every tracked sphere/relay and delete their tmp dirs. Call in afterAll. */
export async function cleanupTestEnv() {
    keyring.length = 0;
    for (const s of spheres.splice(0)) {
        try { s.disableSigning?.(); } catch { /* no signer */ }
        try { await s.close?.(); } catch { /* already closed */ }
    }
    for (const r of relays.splice(0)) {
        try { await r.close(); } catch { /* already closed */ }
    }
    for (const d of dirs.splice(0)) {
        try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* tmp reaper's problem */ }
    }
}
