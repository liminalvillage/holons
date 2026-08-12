// reconnect-resilience.test.js
//
// Long-lived pages (kiosk screens, dashboards) must survive relay outages.
// Gun's stock websocket layer orphans a peer whose first ~2s reconnect
// attempt fails (its `bye` handler deletes the peer from opt.peers and the
// reconnect loop bails on a missing entry), never replenishes the reconnect
// budget, and never detects half-open sockets. holosphere.js closes those
// gaps: `retry: Infinity` by default, peer re-registration after `bye`, a
// debounced getAll resync after `hi`, and a heartbeat that force-closes
// silent-but-OPEN wires. These tests drive the layer by emitting Gun's own
// root `hi`/`bye` events — no real disconnect needed.

import HoloSphere from '../holosphere.js';
import { jest } from '@jest/globals';
import { isolatedGunOptions, startLocalRelay, cleanupTestEnv } from './helpers/testenv.js';

jest.setTimeout(30000);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// From holosphere.js — resync fires RECONNECT_RESYNC_DEBOUNCE_MS (2000ms)
// after the first `hi`; wait past it with slack.
const AFTER_DEBOUNCE_MS = 2600;

describe('connection resilience', () => {
    let hs;
    let relay;

    // The peer-bookkeeping tests need a REAL configured peer in opt.peers
    // (they read hs._resilientPeers) — a throwaway local relay provides one
    // without ever dialing production.
    beforeAll(async () => {
        relay = await startLocalRelay();
    });

    afterAll(cleanupTestEnv, 30000);

    beforeEach(() => {
        hs = new HoloSphere(
            'test-reconnect-resilience',
            false,
            null,
            isolatedGunOptions({ peers: [relay.url] }),
        );
    });

    afterEach(async () => {
        if (hs) await hs.close();
    }, 30000);

    test('defaults to an unlimited websocket reconnect budget', () => {
        // Gun's websocket.js computes `peer.retry = peer.retry || opt.retry+1`
        // and gives up at <= 0; Infinity keeps the loop alive forever.
        expect(hs.gun._.opt.retry).toBe(Infinity);
    });

    test('caller-supplied gun options still override retry', async () => {
        const custom = new HoloSphere('test-reconnect-custom', false, null, isolatedGunOptions({ retry: 5 }));
        try {
            expect(custom.gun._.opt.retry).toBe(5);
        } finally {
            await custom.close();
        }
    });

    test('a peer dropped by bye is re-registered so the reconnect loop keeps going', async () => {
        const opt = hs.gun._.opt;
        const url = [...hs._resilientPeers][0];
        expect(url).toBeTruthy();
        const peer = opt.peers[url];
        expect(peer).toBeTruthy();

        // Emit Gun's own bye: mesh's handler deletes opt.peers[url] after the
        // listener chain; our layer must restore it a tick later.
        hs.gun._.on('bye', peer);
        expect(opt.peers[url]).toBeUndefined();
        await wait(50);
        expect(opt.peers[url]).toBe(peer);
    });

    test('hi after bye re-reads every live-subscribed path exactly once (debounced)', async () => {
        const stamp = Date.now();
        const holonA = `resil_${stamp}_a`;
        const holonB = `resil_${stamp}_b`;
        const subA = hs.subscribe(holonA, 'quests', () => {});
        const subB = hs.subscribe(holonB, 'library', () => {});

        const calls = [];
        hs.getAll = async (holon, lens) => {
            calls.push(`${holon}/${lens}`);
            return [];
        };

        // Two disconnect/reconnect flaps inside the debounce window → one pass.
        const fakePeer = { id: 'fake', url: 'fake' };
        hs.gun._.on('bye', fakePeer);
        hs.gun._.on('hi', fakePeer);
        hs.gun._.on('bye', fakePeer);
        hs.gun._.on('hi', fakePeer);
        await wait(AFTER_DEBOUNCE_MS);

        expect(calls.sort()).toEqual(
            [`${holonA}/quests`, `${holonB}/library`].sort(),
        );

        subA.unsubscribe();
        subB.unsubscribe();
    });

    test('an initial hi (no prior bye) does not trigger a resync', async () => {
        const sub = hs.subscribe(`resil_${Date.now()}_c`, 'quests', () => {});
        const calls = [];
        hs.getAll = async (holon, lens) => {
            calls.push(`${holon}/${lens}`);
            return [];
        };

        hs.gun._.on('hi', { id: 'fake', url: 'fake' });
        await wait(AFTER_DEBOUNCE_MS);

        expect(calls).toEqual([]);
        sub.unsubscribe();
    });

    test('unsubscribed paths are not resynced', async () => {
        const stamp = Date.now();
        const keep = `resil_${stamp}_keep`;
        const drop = `resil_${stamp}_drop`;
        const subKeep = hs.subscribe(keep, 'quests', () => {});
        const subDrop = hs.subscribe(drop, 'quests', () => {});
        subDrop.unsubscribe();

        const calls = [];
        hs.getAll = async (holon, lens) => {
            calls.push(`${holon}/${lens}`);
            return [];
        };

        const fakePeer = { id: 'fake', url: 'fake' };
        hs.gun._.on('bye', fakePeer);
        hs.gun._.on('hi', fakePeer);
        await wait(AFTER_DEBOUNCE_MS);

        expect(calls).toEqual([`${keep}/quests`]);
        subKeep.unsubscribe();
    });

    test('close() cancels a pending resync', async () => {
        const sub = hs.subscribe(`resil_${Date.now()}_d`, 'quests', () => {});
        const calls = [];
        hs.getAll = async (holon, lens) => {
            calls.push(`${holon}/${lens}`);
            return [];
        };

        const fakePeer = { id: 'fake', url: 'fake' };
        hs.gun._.on('bye', fakePeer);
        hs.gun._.on('hi', fakePeer);
        sub.unsubscribe();
        await hs.close();
        const closed = hs;
        hs = null; // afterEach must not double-close
        await wait(AFTER_DEBOUNCE_MS);

        expect(calls).toEqual([]);
        expect(closed._resyncTimer).toBeNull();
        expect(closed._heartbeatTimer).toBeNull();
    });

    test('heartbeat pings a silent OPEN wire, then force-closes it', () => {
        const opt = hs.gun._.opt;
        const url = [...hs._resilientPeers][0];
        const peer = opt.peers[url];
        // Stub methods on the REAL mesh (replacing the object breaks Gun's
        // stats timer, which reads opt.mesh.bye.time). `mesh.hear` is a
        // function carrying its received-message counter as `.c`; the ticks
        // below are synchronous, so no real traffic can move it mid-test.
        const mesh = opt.mesh;
        const origSay = mesh.say;
        const origHeard = mesh.hear.c;
        const origWire = peer.wire;
        try {
            const said = [];
            let closedWire = 0;
            mesh.say = (msg) => said.push(msg);
            mesh.hear.c = 42;
            peer.wire = { readyState: 1, close: () => { closedWire++; } };

            hs._lastHeard = 42; // no traffic since last tick
            hs._heartbeatTick(); // quiet #1 → ping
            expect(said.length).toBe(1);
            expect(said[0].dam).toBe('?');
            expect(closedWire).toBe(0);

            hs._heartbeatTick(); // still quiet → zombie, force-close
            expect(closedWire).toBe(1);

            // Traffic resumes → healthy, no ping/close.
            mesh.hear.c = 99;
            peer.wire = { readyState: 1, close: () => { closedWire++; } };
            hs._heartbeatTick();
            expect(said.length).toBe(1);
            expect(closedWire).toBe(1);
            expect(peer.__hbPinged).toBe(false);
        } finally {
            mesh.say = origSay;
            mesh.hear.c = origHeard;
            peer.wire = origWire;
            peer.__hbPinged = false;
        }
    });
});
