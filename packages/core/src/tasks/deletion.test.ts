import { describe, expect, it, vi } from 'vitest';
import { deleteTaskWithCascade, readForwardSouls } from './deletion.js';
import type { HoloSphere } from 'holosphere';

interface MockOpts {
	/** Forwards published from the source, written to its `_holograms` set. */
	forwards?: string[];
	/** Forwards whose delete call should throw AuthorizationError. */
	denyDeleteFor?: string[];
	/** Throw when the source delete is attempted. */
	failSourceDelete?: boolean;
	appname?: string;
}

function mockHolosphere(opts: MockOpts = {}) {
	const appname = opts.appname ?? 'test-app';
	const forwards = opts.forwards ?? [];
	const denySet = new Set(opts.denyDeleteFor ?? []);

	const deleteCalls: Array<{ holon: string; lens: string; key: string }> = [];
	const del = vi.fn(async (holon: string, lens: string, key: string) => {
		const soul = `${appname}/${holon}/${lens}/${key}`;
		if (opts.failSourceDelete && soul.endsWith('/source-q')) {
			throw new Error('source delete blew up');
		}
		if (denySet.has(soul)) {
			const e: any = new Error('Write access denied');
			e.name = 'AuthorizationError';
			throw e;
		}
		deleteCalls.push({ holon, lens, key });
	});

	// getNodeRef('source-soul').get('_holograms').once(cb) → cb({soul1: true, soul2: true, dead: null})
	const getNodeRef = vi.fn((_soul: string) => ({
		get: (k: string) => ({
			once: (cb: (d: any) => void) => {
				if (k !== '_holograms') return cb(null);
				const data: Record<string, any> = { _: { '#': 'meta' } };
				for (const f of forwards) data[f] = true;
				cb(data);
			}
		})
	}));

	const parseSoulPath = vi.fn((soul: string) => {
		if (typeof soul !== 'string') return null;
		const parts = soul.split('/');
		if (parts.length < 4) return null;
		return {
			appname: parts[0],
			holon: parts[1],
			lens: parts[2],
			key: parts.slice(3).join('/')
		};
	});

	const holosphere = {
		appname,
		delete: del,
		getNodeRef,
		parseSoulPath
	} as unknown as HoloSphere;

	return { holosphere, del, deleteCalls, getNodeRef };
}

describe('readForwardSouls', () => {
	it('returns live forward souls and skips tombstones + metadata', async () => {
		const m = mockHolosphere({
			forwards: ['test-app/a/quests/q-1', 'test-app/b/quests/q-1']
		});
		const out = await readForwardSouls(m.holosphere, 'test-app/source/quests/source-q');
		expect(out).toEqual([
			'test-app/a/quests/q-1',
			'test-app/b/quests/q-1'
		]);
	});

	it('resolves to [] when getNodeRef returns no data', async () => {
		const holosphere = {
			getNodeRef: () => ({
				get: () => ({ once: (cb: any) => cb(null) })
			})
		} as unknown as HoloSphere;
		expect(await readForwardSouls(holosphere, 's')).toEqual([]);
	});

	it('times out and resolves [] if Gun never calls back', async () => {
		const holosphere = {
			getNodeRef: () => ({
				get: () => ({ once: (_cb: any) => {} })
			})
		} as unknown as HoloSphere;
		const out = await readForwardSouls(holosphere, 's', 50);
		expect(out).toEqual([]);
	});
});

describe('deleteTaskWithCascade', () => {
	it('deletes the source and every forward', async () => {
		const m = mockHolosphere({
			forwards: [
				'test-app/user-1/quests/source-q',
				'test-app/user-2/quests/source-q'
			]
		});
		const out = await deleteTaskWithCascade(m.holosphere, 'source', 'source-q');
		expect(out).toEqual({
			sourceDeleted: true,
			forwardsFound: 2,
			forwardsDeleted: 2,
			forwardsFailed: 0
		});
		expect(m.deleteCalls).toEqual([
			{ holon: 'source', lens: 'quests', key: 'source-q' },
			{ holon: 'user-1', lens: 'quests', key: 'source-q' },
			{ holon: 'user-2', lens: 'quests', key: 'source-q' }
		]);
	});

	it('skips forwards whose delete is denied and still completes', async () => {
		const m = mockHolosphere({
			forwards: [
				'test-app/user-1/quests/source-q',
				'test-app/locked/quests/source-q'
			],
			denyDeleteFor: ['test-app/locked/quests/source-q']
		});
		const out = await deleteTaskWithCascade(m.holosphere, 'source', 'source-q');
		expect(out.sourceDeleted).toBe(true);
		expect(out.forwardsFound).toBe(2);
		expect(out.forwardsDeleted).toBe(1);
		expect(out.forwardsFailed).toBe(1);
	});

	it('does not cascade when the source delete itself fails', async () => {
		const m = mockHolosphere({
			forwards: ['test-app/user-1/quests/source-q'],
			failSourceDelete: true
		});
		const out = await deleteTaskWithCascade(m.holosphere, 'source', 'source-q');
		expect(out).toEqual({
			sourceDeleted: false,
			forwardsFound: 1,
			forwardsDeleted: 0,
			forwardsFailed: 0
		});
		// Only the source-delete attempt should have happened.
		expect(m.deleteCalls.length).toBe(0);
		expect(m.del).toHaveBeenCalledTimes(1);
	});

	it('handles zero forwards (no _holograms set) cleanly', async () => {
		const m = mockHolosphere({ forwards: [] });
		const out = await deleteTaskWithCascade(m.holosphere, 'source', 'source-q');
		expect(out).toEqual({
			sourceDeleted: true,
			forwardsFound: 0,
			forwardsDeleted: 0,
			forwardsFailed: 0
		});
	});

	it('counts unparseable souls as failed without throwing', async () => {
		const m = mockHolosphere({
			forwards: [
				'not-a-soul',
				'wrong-app/h/quests/q-1',
				'test-app/h/quests/q-1'
			]
		});
		const out = await deleteTaskWithCascade(m.holosphere, 'source', 'source-q');
		expect(out.sourceDeleted).toBe(true);
		expect(out.forwardsFound).toBe(3);
		expect(out.forwardsDeleted).toBe(1);
		expect(out.forwardsFailed).toBe(2);
	});
});
