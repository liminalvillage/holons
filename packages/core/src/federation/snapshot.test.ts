import { describe, expect, it, vi } from 'vitest';
import { getFederationSnapshot, partnersReceivingLens } from './snapshot.js';
import type { HoloSphere } from 'holosphere';

function mockHolosphere(fedInfo: any): HoloSphere {
	return {
		getFederation: vi.fn(async () => fedInfo)
	} as unknown as HoloSphere;
}

describe('getFederationSnapshot', () => {
	it('passes through the partner list, names, and directional lens config', async () => {
		const hs = mockHolosphere({
			federated: ['A', 'B'],
			partnerNames: { A: 'Alpha', B: 'Beta' },
			lensConfig: {
				A: { inbound: ['quests', 'library'], outbound: ['roles'] },
				B: { inbound: ['library'], outbound: [] }
			}
		});

		const snap = await getFederationSnapshot(hs, 'home');

		expect(snap.federated).toEqual(['A', 'B']);
		expect(snap.partnerNames).toEqual({ A: 'Alpha', B: 'Beta' });
		expect(snap.lensConfig).toEqual({
			A: { inbound: ['quests', 'library'], outbound: ['roles'] },
			B: { inbound: ['library'], outbound: [] }
		});
	});

	it('defaults to empty structures when the federation node is absent', async () => {
		const snap = await getFederationSnapshot(mockHolosphere(null), 'home');
		expect(snap.federated).toEqual([]);
		expect(snap.partnerNames).toEqual({});
		expect(snap.lensConfig).toEqual({});
	});

	it('normalizes malformed lens config (missing/non-array directions)', async () => {
		const hs = mockHolosphere({
			federated: ['A'],
			lensConfig: { A: { inbound: 'quests' /* not an array */ } }
		});
		const snap = await getFederationSnapshot(hs, 'home');
		expect(snap.lensConfig).toEqual({ A: { inbound: [], outbound: [] } });
	});

	it('uses the explicit federation source id when given', async () => {
		const getFederation = vi.fn(async () => ({ federated: [] }));
		const hs = { getFederation } as unknown as HoloSphere;
		await getFederationSnapshot(hs, 'home', 'nostr-key');
		expect(getFederation).toHaveBeenCalledWith('nostr-key');
	});
});

describe('partnersReceivingLens', () => {
	const snap = {
		federated: ['A', 'B', 'C'],
		partnerNames: {},
		lensConfig: {
			A: { inbound: ['quests', 'library'], outbound: ['quests'] },
			B: { inbound: ['library'], outbound: [] },
			// C is federated but has no inbound flow configured at all.
			C: { inbound: [], outbound: ['quests'] }
		}
	};

	it('returns only partners whose inbound list includes the lens', () => {
		expect(partnersReceivingLens(snap, 'quests')).toEqual(['A']);
		expect(partnersReceivingLens(snap, 'library')).toEqual(['A', 'B']);
	});

	it('excludes outbound-only and unconfigured partners', () => {
		// C only sends quests (outbound); it must not leak its quests back to us.
		expect(partnersReceivingLens(snap, 'quests')).not.toContain('C');
		expect(partnersReceivingLens(snap, 'roles')).toEqual([]);
	});

	it('excludes a partner present in `federated` but missing from lensConfig', () => {
		const s = { federated: ['A', 'Z'], partnerNames: {}, lensConfig: { A: { inbound: ['quests'], outbound: [] } } };
		expect(partnersReceivingLens(s, 'quests')).toEqual(['A']);
	});
});
