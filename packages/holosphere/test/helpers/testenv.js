// Shared test environment: fully isolated HoloSphere instances.
//
// Every suite builds instances through this helper: a fresh in-memory store
// per instance and no relays, so suites are hermetic and parallel-safe.
// Cross-holon behaviour (holograms, federation) lives inside ONE store — a
// single isolated instance exercises it fully. For the rare test that
// genuinely needs two instances syncing over a wire, `startLocalRelay()`
// boots an in-process Nostr relay on an ephemeral port.

import HoloSphere from '../../holosphere.js';
import { generateSecretKey, buildEvent } from '../../nostr-events.js';
import { startRelay } from '../../spike/mini-relay.js';

const spheres = [];
const relays = [];

// HOLO_TEST_SIGNING=shadow|enforce runs every testSphere() with a signing
// identity and the given READ mode (shadow measurement / enforce authorized
// reads), so the whole suite exercises those paths. Unset = plain signed
// writes with no read gating.
const ENV_SIGNING = process.env.HOLO_TEST_SIGNING || '';
// Spheres created in this worker so far, for cross-trust wiring: in enforce
// mode every sphere must have every other sphere's pubkey in its read-list or
// multi-instance tests (over startLocalRelay) would drop each other's writes.
const keyring = [];

/**
 * An isolated HoloSphere on a fresh in-memory store. Registered for
 * `cleanupTestEnv()`. Options:
 *   strict   — schema enforcement
 *   relays   — relay URLs (e.g. `[relay.url]` from `startLocalRelay`)
 *   store    — store options (`{ adapter }`) to override the memory default
 *   signing  — `{ mode: 'shadow'|'enforce', privateKey?, readKeys? }`
 *
 * Returns the sphere directly on the default path. With HOLO_TEST_SIGNING (or
 * an explicit `signing.mode`) it returns a Promise of the sphere instead —
 * `await testSphere(...)` works in both modes, and every call site awaits.
 */
export function testSphere(appName, { strict = false, relays: relayUrls = [], store, signing, privateKey, syncTimeoutMs = 3000 } = {}) {
    const mode = signing?.mode ?? (ENV_SIGNING || null);
    const sphere = new HoloSphere({
        appName,
        strict,
        privateKey: signing?.privateKey ?? privateKey ?? generateSecretKey(),
        relays: relayUrls,
        store: { adapter: 'memory', ...(store || {}) },
        nostr: { syncTimeoutMs },
    });
    spheres.push(sphere);
    if (!mode) return sphere;
    if (mode !== 'shadow' && mode !== 'enforce') {
        throw new Error(`testSphere: unknown signing mode '${mode}' (use shadow|enforce)`);
    }
    return (async () => {
        await sphere.enableSigning({
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
 * A throwaway in-process Nostr relay on an ephemeral localhost port. Returns
 * `{ url, close, events, count }`; `url` goes straight into `relays`.
 */
export async function startLocalRelay() {
    const relay = await startRelay({ port: 0 });
    relays.push(relay);
    return relay;
}

/** Close every tracked sphere/relay. Call in afterAll. */
export async function cleanupTestEnv() {
    keyring.length = 0;
    for (const s of spheres.splice(0)) {
        try { s.disableSigning?.(); } catch { /* no signer */ }
        try { await s.close?.(); } catch { /* already closed */ }
    }
    for (const r of relays.splice(0)) {
        try { await r.close(); } catch { /* already closed */ }
    }
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `pred` until truthy (or the timeout elapses). */
export async function waitFor(pred, timeout = 12000, step = 50) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await pred()) return true; await wait(step); }
    return false;
}

/**
 * Simulate another key's write arriving from the wire: build a signed event
 * for (holon, lens, item) and apply it to the sphere's store as remote.
 */
export function injectSigned(sphere, holon, lens, item, sk, at) {
    const evt = buildEvent({ holon, lens, item, sk, created_at: at, extraTags: [['n', sphere.appname]] });
    return sphere.store.apply(evt, { origin: 'remote' });
}
