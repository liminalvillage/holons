import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from '../../store/index.js';
import { createFileAdapter } from '../../store/adapters/file.js';
import { APP, keypair, signed } from './helpers.js';

describe('store/adapters/file: JSONL log + snapshot', () => {
    let dir;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holo-store-')); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    const openStore = async (opts = {}) => {
        const store = createStore({ appName: APP, adapter: 'file', dir, ...opts });
        await store.open();
        return store;
    };

    test('records, events, private and cursors survive close + reopen', async () => {
        const a = keypair();
        const s1 = await openStore();
        const evt = signed({ item: { id: 't1', title: 'A' }, sk: a.sk });
        s1.apply(evt);
        s1.putRaw('h1', 'tasks', 't2', { id: 't2' });
        s1.privatePut('App:h1', 'notes', 'n1', 'cipher');
        s1.setCursor('h1', 'tasks', 123);
        await s1.close();

        expect(fs.existsSync(path.join(dir, `${APP}.log.jsonl`))).toBe(true);
        const s2 = await openStore();
        expect(s2.get('h1', 'tasks', 't1').item.title).toBe('A');
        expect(s2.getEvents('h1', 'tasks', 't1')[0].id).toBe(evt.id);
        expect(s2.get('h1', 'tasks', 't2').origin).toBe('raw');
        expect(s2.privateGet('App:h1', 'notes', 'n1')).toBe('cipher');
        expect(s2.getCursor('h1', 'tasks').since).toBe(123);
        // the log was compacted into the snapshot on open
        expect(fs.readFileSync(path.join(dir, `${APP}.log.jsonl`), 'utf8')).toBe('');
        expect(JSON.parse(fs.readFileSync(path.join(dir, `${APP}.snapshot.json`), 'utf8')).records).toHaveLength(2);
        await s2.close();
    });

    test('a torn last log line is tolerated', async () => {
        const s1 = await openStore();
        s1.putRaw('h1', 'tasks', 't1', { id: 't1' });
        await s1.close();
        fs.appendFileSync(path.join(dir, `${APP}.log.jsonl`), '{"t":"rec","v":{"addr":"x');
        const s2 = await openStore();
        expect(s2.listKeys('h1', 'tasks')).toEqual(['t1']);
        await s2.close();
    });

    test('superseded events are dropped from the log on compaction', async () => {
        const a = keypair();
        const s1 = await openStore();
        const now = Math.floor(Date.now() / 1000);
        const v1 = signed({ item: { id: 't1', v: 1 }, sk: a.sk, created_at: now - 1 });
        const v2 = signed({ item: { id: 't1', v: 2 }, sk: a.sk, created_at: now });
        s1.apply(v1);
        s1.apply(v2);
        await s1.close();
        const s2 = await openStore();
        expect(s2.events.size).toBe(1);
        expect(s2.events.has(v2.id)).toBe(true);
        await s2.close();
    });

    test('compaction runs after compactAfter ops', async () => {
        const s1 = await openStore({ compactAfter: 5 });
        for (let i = 0; i < 6; i++) s1.putRaw('h1', 'tasks', `t${i}`, { id: `t${i}` });
        await s1.flush();
        await s1.close();
        const snap = JSON.parse(fs.readFileSync(path.join(dir, `${APP}.snapshot.json`), 'utf8'));
        expect(snap.records.length).toBeGreaterThanOrEqual(5);
    });

    test('adapter stats and clear', async () => {
        const adapter = createFileAdapter({ dir, appName: APP });
        const store = createStore({ appName: APP, adapter });
        await store.open();
        store.putRaw('h1', 'tasks', 't1', { id: 't1' });
        await store.flush();
        expect(adapter.stats().logBytes).toBeGreaterThan(0);
        await store.clear();
        expect(fs.existsSync(adapter.logPath)).toBe(false);
        await store.close();
    });
});
