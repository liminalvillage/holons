// Cross-holon hologram soul resolution on a COLD instance.
//
// A hologram soul points at another holon's lens this instance may never
// have opened. Resolving it must catch that lens up from the relay first —
// the source is almost always remote — and a relay that never answers must
// bound the read by the sync timeout instead of hanging.

import HoloSphere from '../holosphere.js';
import { generateSecretKey } from '../nostr-events.js';
import { testSphere, startLocalRelay, cleanupTestEnv, waitFor } from './helpers/testenv.js';

const APP = 'test-cold-soul';

describe('cold cross-holon soul resolution', () => {
    let relay;

    beforeAll(async () => { relay = await startLocalRelay(); }, 30000);
    afterAll(cleanupTestEnv, 30000);

    test('a pointer resolves through a source lens this instance never opened', async () => {
        const writer = await testSphere(APP, { relays: [relay.url] });
        await writer.ready();
        const key = 'quest-cold-1';
        await writer.put('source-holon', 'quests', { id: key, title: 'present after sync', description: '' });
        expect(await waitFor(() => relay.count() >= 1)).toBe(true);

        const reader = await testSphere(APP, { relays: [relay.url] });
        await reader.ready();
        expect(reader.store.listKeys('source-holon', 'quests')).toEqual([]); // cold

        const soul = `${APP}/source-holon/quests/${key}`;
        const resolved = await reader.resolveHologram({ id: key, soul });

        expect(resolved).toBeTruthy();
        expect(resolved.title).toBe('present after sync');
        expect(resolved._hologram?.soul).toBe(soul);
        expect(resolved._hologram?.sourceHolon).toBe('source-holon');

        // and a missing key on the now-synced lens resolves null fast
        const start = Date.now();
        expect(await reader.get('source-holon', 'quests', 'missing-key')).toBeNull();
        expect(Date.now() - start).toBeLessThan(500);
    }, 20000);

    test('an unreachable relay bounds the read by the sync timeout', async () => {
        const lonely = new HoloSphere({
            appName: APP,
            privateKey: generateSecretKey(),
            relays: ['ws://127.0.0.1:1'],
            store: { adapter: 'memory' },
            nostr: { syncTimeoutMs: 600 },
        });
        try {
            const start = Date.now();
            const v = await lonely.get('source-holon', 'items', 'never-answers');
            const elapsed = Date.now() - start;
            expect(v).toBeNull();
            expect(elapsed).toBeLessThan(3000);
        } finally {
            await lonely.close();
        }
    }, 15000);
});
