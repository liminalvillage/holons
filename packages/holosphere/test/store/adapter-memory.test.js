import { createStore, createMemoryAdapter, resolveAdapter } from '../../store/index.js';
import { APP } from './helpers.js';

describe('store/adapters/memory', () => {
    test('the default adapter persists nothing across stores', async () => {
        const s1 = createStore({ appName: APP, adapter: 'memory' });
        await s1.open();
        s1.putRaw('h1', 'tasks', 't1', { id: 't1' });
        await s1.close();
        const s2 = createStore({ appName: APP, adapter: 'memory' });
        await s2.open();
        expect(s2.listKeys('h1', 'tasks')).toEqual([]);
        await s2.close();
    });

    test('retain: true hydrates a second store on the same adapter instance', async () => {
        const adapter = createMemoryAdapter({ retain: true });
        const s1 = createStore({ appName: APP, adapter });
        await s1.open();
        s1.putRaw('h1', 'tasks', 't1', { id: 't1' });
        await s1.close();
        const s2 = createStore({ appName: APP, adapter });
        await s2.open();
        expect(s2.listKeys('h1', 'tasks')).toEqual(['t1']);
        await s2.clear();
        await s2.close();
        const s3 = createStore({ appName: APP, adapter });
        await s3.open();
        expect(s3.listKeys('h1', 'tasks')).toEqual([]);
        await s3.close();
    });

    test('resolveAdapter accepts names, instances and rejects unknown names', () => {
        expect(resolveAdapter('memory').kind).toBe('memory');
        expect(typeof resolveAdapter('file', { appName: APP, dir: '/tmp/x' })).toBe('function');
        const inst = createMemoryAdapter();
        expect(resolveAdapter(inst)).toBe(inst);
        expect(() => resolveAdapter('radisk')).toThrow(/unknown adapter/);
    });

    test('open is idempotent and use after close throws on open', async () => {
        const store = createStore({ appName: APP, adapter: 'memory' });
        await store.open();
        await store.open();
        await store.close();
        await store.close();
        const fresh = createStore({ appName: APP, adapter: 'memory' });
        await fresh.close();
        await expect(fresh.open()).rejects.toThrow(/closed/);
    });

    test('appName is required', () => {
        expect(() => createStore({ adapter: 'memory' })).toThrow(/appName/);
    });
});
