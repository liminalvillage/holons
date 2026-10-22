/**
 * An append-only lens keeps every signed entry.
 *
 * The lens rides a REGULAR kind (1808) and each event is its own record,
 * addressed by the event id — so the store's one ordering rule never sees a
 * second claim at an address, nothing is superseded, nothing is tombstoned,
 * and the log is the same on every store whatever order it arrived in.
 */
import { buildLogEvent, generateSecretKey, getPublicKey, HOLOSPHERE_LOG_KIND } from '../../nostr-events.js';
import { createMemoryAdapter } from '../../store/index.js';
import { testSphere, startLocalRelay, cleanupTestEnv, waitFor, injectSigned } from '../helpers/testenv.js';

const APP = 'append-wire-test';
const HOLON = 'append-holon';
const LENS = 'flow_claims';
const PLAIN = 'tasks';

/** A log entry signed by `sk`, in the shape the relay would carry. */
const logEvent = ({ holon = HOLON, lens = LENS, item, sk, created_at, refs, app = APP }) =>
    buildLogEvent({ holon, lens, item, sk, created_at, refs, extraTags: [['n', app]] });

describe('append-only lens', () => {
    afterAll(async () => { await cleanupTestEnv(); });

    test('every entry is kept — same author, same second, nothing superseded', async () => {
        const adapter = createMemoryAdapter();
        const ops = [];
        const orig = adapter.append.bind(adapter);
        adapter.append = async (batch) => { ops.push(...batch); return orig(batch); };
        const sphere = await testSphere(APP, { store: { adapter, appendLenses: [LENS] } });
        const at = Math.floor(Date.now() / 1000);
        const a = await sphere.append(HOLON, LENS, { amount: 5 }, { created_at: at });
        const b = await sphere.append(HOLON, LENS, { amount: 7 }, { created_at: at });
        expect(a.kind).toBe(HOLOSPHERE_LOG_KIND);
        expect(a.id).not.toBe(b.id);

        const log = await sphere.getLog(HOLON, LENS);
        expect(log.map((e) => e.item.amount).sort()).toEqual([5, 7]);
        expect(log.every((e) => e.pubkey === sphere.currentPubkey)).toBe(true);
        expect(log[0].item.id).toBe(log[0].id);
        expect(log[0].item._log.pubkey).toBe(sphere.currentPubkey);
        expect(sphere.store.events.size).toBe(2);
        await sphere.store.flush();
        expect(ops.some((op) => op.t === 'evt-del')).toBe(false);
    });

    test("an author's own entries never share a second — append order is log order", async () => {
        const sphere = await testSphere(APP, { store: { appendLenses: [LENS] } });
        const a = await sphere.append(HOLON, LENS, { n: 1 });
        const b = await sphere.append(HOLON, LENS, { n: 2 });
        const c = await sphere.append(HOLON, LENS, { n: 3 });
        expect(b.created_at).toBeGreaterThan(a.created_at);
        expect(c.created_at).toBeGreaterThan(b.created_at);
        expect((await sphere.getLog(HOLON, LENS)).map((e) => e.item.n)).toEqual([1, 2, 3]);
    });

    test('refs travel on e tags and come back by marker', async () => {
        const sphere = await testSphere(APP, { store: { appendLenses: [LENS] } });
        const first = await sphere.append(HOLON, LENS, { amount: 1 });
        const second = await sphere.append(HOLON, LENS, { amount: 2 }, { refs: { prev: first.id, basis: [first.id] } });
        const att = await sphere.append(HOLON, LENS, { verdict: 'attest' }, { refs: [{ id: second.id, marker: 'attests' }] });
        const log = await sphere.getLog(HOLON, LENS);
        const byId = new Map(log.map((e) => [e.id, e]));
        expect(byId.get(second.id).refs.prev).toEqual([first.id]);
        expect(byId.get(second.id).refs.basis).toEqual([first.id]);
        expect(byId.get(att.id).refs.attests).toEqual([second.id]);
        expect(byId.get(first.id).refs.prev).toEqual([]);
    });

    test('the log reads the same whatever order the entries arrived in', async () => {
        const sk = generateSecretKey();
        const now = Math.floor(Date.now() / 1000);
        const events = [
            logEvent({ item: { n: 1 }, sk, created_at: now - 30 }),
            logEvent({ item: { n: 2 }, sk, created_at: now - 20 }),
            logEvent({ item: { n: 3 }, sk, created_at: now - 20 }), // same second as #2: id breaks the tie
            logEvent({ item: { n: 4 }, sk, created_at: now - 10 }),
        ];
        const forward = await testSphere(APP, { store: { appendLenses: [LENS] } });
        const reverse = await testSphere(APP, { store: { appendLenses: [LENS] } });
        await forward.importEvents(events);
        await reverse.importEvents([...events].reverse());
        const f = (await forward.getLog(HOLON, LENS)).map((e) => e.id);
        const r = (await reverse.getLog(HOLON, LENS)).map((e) => e.id);
        expect(f).toEqual(r);
        expect(f).toHaveLength(4);
        expect(f[0]).toBe(events[0].id);
        expect(f[3]).toBe(events[3].id);
    });

    test('a forged replaceable tombstone at a log address is not a claim', async () => {
        const sphere = await testSphere(APP, { store: { appendLenses: [LENS] } });
        const entry = await sphere.append(HOLON, LENS, { amount: 9 });
        const attacker = generateSecretKey();
        const r = injectSigned(sphere, HOLON, LENS, { id: entry.id, _deleted: true }, attacker, entry.created_at + 60);
        expect(r.applied).toBe(false);
        expect(r.reason).toBe('malformed');
        const log = await sphere.getLog(HOLON, LENS);
        expect(log.map((e) => e.id)).toEqual([entry.id]);
        expect(log[0].item.amount).toBe(9);
    });

    test('a log event for a lens nobody registered as append-only is not ours', async () => {
        const sphere = await testSphere(APP, { store: { appendLenses: [LENS] } });
        const stray = logEvent({ lens: PLAIN, item: { n: 1 }, sk: generateSecretKey() });
        const r = sphere.store.apply(stray, { origin: 'remote' });
        expect(r.applied).toBe(false);
        expect(sphere.store.list(HOLON, PLAIN)).toHaveLength(0);
    });

    test('put and delete refuse an append-only lens; a plain lens is unaffected', async () => {
        const sphere = await testSphere(APP, { store: { appendLenses: [LENS] } });
        await expect(sphere.put(HOLON, LENS, { id: 'x', amount: 1 })).rejects.toThrow(/append-only/);
        await expect(sphere.delete(HOLON, LENS, 'x')).rejects.toThrow(/append-only/);
        await expect(sphere.deleteAll(HOLON, LENS)).rejects.toThrow(/append-only/);
        await expect(sphere.append(HOLON, PLAIN, { n: 1 })).rejects.toThrow(/not an append-only lens/);
        await expect(sphere.put(HOLON, PLAIN, { id: 't1', title: 'ok' })).resolves.toBeTruthy();
    });

    test('appendSigned takes an entry signed by another key', async () => {
        const sphere = await testSphere(APP, { store: { appendLenses: [LENS] } });
        const member = generateSecretKey();
        const ev = logEvent({ item: { amount: 3 }, sk: member });
        const r = await sphere.appendSigned(ev);
        expect(r.applied).toBe(true);
        const log = await sphere.getLog(HOLON, LENS);
        expect(log).toHaveLength(1);
        expect(log[0].pubkey).toBe(getPublicKey(member));
        // Narrowing by author works on the verified envelope, not on the body.
        expect(await sphere.getLog(HOLON, LENS, { authors: [sphere.currentPubkey] })).toHaveLength(0);
        // A foreign-namespace or non-log event is refused.
        await expect(sphere.appendSigned(logEvent({ item: { n: 1 }, sk: member, app: 'other-app' }))).rejects.toThrow(/not applied/);
        await expect(sphere.appendSigned({ kind: 30078 })).rejects.toThrow(/not a log event/);
    });

    test('registerAppendLens is idempotent and takes effect on a running store', async () => {
        const sphere = await testSphere(APP);
        expect(sphere.isAppendLens(LENS)).toBe(false);
        sphere.registerAppendLens(LENS);
        sphere.registerAppendLens(LENS);
        expect(sphere.isAppendLens(LENS)).toBe(true);
        expect(sphere.store.wire.wiresFor(LENS)).toHaveLength(1);
        await sphere.append(HOLON, LENS, { n: 1 });
        expect(await sphere.getLog(HOLON, LENS)).toHaveLength(1);
    });

    test('subscribeLog replays in log order, then streams new entries once each', async () => {
        const sphere = await testSphere(APP, { store: { appendLenses: [LENS] } });
        const sk = generateSecretKey();
        const now = Math.floor(Date.now() / 1000);
        const older = logEvent({ item: { n: 'older' }, sk, created_at: now - 100 });
        const newer = logEvent({ item: { n: 'newer' }, sk, created_at: now - 50 });
        await sphere.importEvents([newer, older]); // arrival order ≠ log order
        const seen = [];
        const off = sphere.subscribeLog(HOLON, LENS, (e) => seen.push(e.item.n));
        await waitFor(() => seen.length === 2);
        expect(seen).toEqual(['older', 'newer']);
        await sphere.append(HOLON, LENS, { n: 'live' });
        await waitFor(() => seen.length === 3);
        expect(seen).toEqual(['older', 'newer', 'live']);
        off();
        await sphere.append(HOLON, LENS, { n: 'after' });
        await new Promise((r) => setTimeout(r, 20));
        expect(seen).toHaveLength(3);
    });

    test('a snapshot round-trip keeps every entry', async () => {
        const adapter = createMemoryAdapter({ retain: true });
        const first = await testSphere(APP, { store: { adapter, appendLenses: [LENS] } });
        await first.append(HOLON, LENS, { n: 1 });
        await first.append(HOLON, LENS, { n: 2 });
        await first.store.flush();
        await first.store.compact();
        const second = await testSphere(APP, { store: { adapter, appendLenses: [LENS] } });
        const log = await second.getLog(HOLON, LENS);
        expect(log.map((e) => e.item.n).sort()).toEqual([1, 2]);
        expect(second.store.events.size).toBe(2);
    });

    test('over a relay: the log lens syncs on its own wire and cursor', async () => {
        const relay = await startLocalRelay();
        const writer = await testSphere(APP, { relays: [relay.url], store: { appendLenses: [LENS] } });
        const reader = await testSphere(APP, { relays: [relay.url], store: { appendLenses: [LENS] } });
        await writer.ready();
        await reader.ready();
        const a = await writer.append(HOLON, LENS, { n: 1 });
        const b = await writer.append(HOLON, LENS, { n: 2 }, { refs: { prev: a.id } });
        expect(await waitFor(async () => (await reader.getLog(HOLON, LENS)).length === 2)).toBe(true);
        const log = await reader.getLog(HOLON, LENS);
        expect(log.map((e) => e.id)).toEqual([a.id, b.id]);
        expect(log[1].refs.prev).toEqual([a.id]);
        expect(reader.store.getCursor(HOLON, LENS, `std:${HOLOSPHERE_LOG_KIND}`)).not.toBeNull();
        expect(relay.events().filter((e) => e.kind === HOLOSPHERE_LOG_KIND)).toHaveLength(2);
    });
});
