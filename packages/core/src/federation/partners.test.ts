// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import {
	applyLensMode,
	lensMode,
	removeFederationPartner,
	setFederationPartner
} from './partners.js';
import type { HoloSphere } from 'holosphere';

function mockHolosphere() {
	return {
		federate: vi.fn(async () => true),
		unfederate: vi.fn(async () => true)
	} as unknown as HoloSphere;
}

describe('lensMode', () => {
	it('reports the mode for each direction combination', () => {
		const dirs = { inbound: ['quests', 'roles'], outbound: ['quests', 'library'] };
		expect(lensMode(dirs, 'quests')).toBe('both');
		expect(lensMode(dirs, 'roles')).toBe('receive');
		expect(lensMode(dirs, 'library')).toBe('send');
		expect(lensMode(dirs, 'checklists')).toBe('off');
	});
});

describe('applyLensMode', () => {
	it('round-trips all four modes', () => {
		let dirs = { inbound: [], outbound: [] } as { inbound: string[]; outbound: string[] };
		for (const mode of ['receive', 'send', 'both', 'off'] as const) {
			dirs = applyLensMode(dirs, 'quests', mode);
			expect(lensMode(dirs, 'quests')).toBe(mode);
		}
	});

	it('leaves other lenses untouched and returns new arrays', () => {
		const dirs = { inbound: ['roles'], outbound: ['library'] };
		const next = applyLensMode(dirs, 'quests', 'both');
		expect(next.inbound).toEqual(['roles', 'quests']);
		expect(next.outbound).toEqual(['library', 'quests']);
		expect(next.inbound).not.toBe(dirs.inbound);
		expect(next.outbound).not.toBe(dirs.outbound);
		expect(dirs).toEqual({ inbound: ['roles'], outbound: ['library'] });
	});

	it('dedupes pre-existing duplicates', () => {
		const next = applyLensMode({ inbound: ['quests', 'quests'], outbound: [] }, 'roles', 'receive');
		expect(next.inbound).toEqual(['quests', 'roles']);
	});
});

// The write path itself (who writes which half, when the partner is asked)
// runs against signed instances in ./requests.test.ts.
describe('setFederationPartner', () => {
	it('rejects self-federation and empty ids without calling holosphere', async () => {
		const hs = mockHolosphere();
		await expect(
			setFederationPartner(hs, 'same', ' same ', { inbound: [], outbound: [] })
		).rejects.toThrow(/itself/);
		await expect(
			setFederationPartner(hs, '', 'partner', { inbound: [], outbound: [] })
		).rejects.toThrow(/holonId/);
		await expect(
			setFederationPartner(hs, 'home', '  ', { inbound: [], outbound: [] })
		).rejects.toThrow(/targetId/);
		expect((hs as any).federate).not.toHaveBeenCalled();
	});
});

describe('removeFederationPartner', () => {
	it('rejects empty ids without calling holosphere', async () => {
		const hs = mockHolosphere();
		await expect(removeFederationPartner(hs, '', 'partner')).rejects.toThrow(/holonId/);
		await expect(removeFederationPartner(hs, 'home', '')).rejects.toThrow(/targetId/);
		expect((hs as any).unfederate).not.toHaveBeenCalled();
	});
});
