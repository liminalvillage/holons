// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { retractFromFederation } from './retract.js';
import type { HoloSphere } from 'holosphere';

function mockHolosphere(opts: { federated?: string[]; denyFor?: string[] } = {}) {
	const del = vi.fn(async (holon: string) => {
		if (opts.denyFor?.includes(holon)) throw new Error('denied');
	});
	const holosphere = {
		delete: del,
		getFederation: vi.fn(async () => ({ federated: opts.federated ?? [] })),
		get: vi.fn(async () => null),
	} as unknown as HoloSphere;
	return { holosphere, del };
}

describe('retractFromFederation', () => {
	it('tombstones the copy on every federation partner', async () => {
		const m = mockHolosphere({ federated: ['p1', 'p2'] });
		const out = await retractFromFederation(m.holosphere, 'h1', 'quests', 'offer-1');
		expect(m.del).toHaveBeenCalledWith('p1', 'quests', 'offer-1');
		expect(m.del).toHaveBeenCalledWith('p2', 'quests', 'offer-1');
		expect(out.retractedFrom).toBe(2);
		expect(out.destinations).toEqual(['p1', 'p2']);
		expect(out.errors).toEqual([]);
	});

	it('honors explicit targets and skips self', async () => {
		const m = mockHolosphere({ federated: ['ignored'] });
		const out = await retractFromFederation(m.holosphere, 'h1', 'quests', 'x', {
			targets: ['h1', 'p9', ''],
		});
		expect(m.del).toHaveBeenCalledTimes(1);
		expect(m.del).toHaveBeenCalledWith('p9', 'quests', 'x');
		expect(out.retractedFrom).toBe(1);
	});

	it('collects per-partner failures without throwing', async () => {
		const m = mockHolosphere({ federated: ['p1', 'p2'], denyFor: ['p1'] });
		const out = await retractFromFederation(m.holosphere, 'h1', 'quests', 'x');
		expect(out.retractedFrom).toBe(1);
		expect(out.destinations).toEqual(['p2']);
		expect(out.errors.join(' ')).toMatch(/p1: denied/);
	});

	it('rejects a missing item id up front', async () => {
		const m = mockHolosphere({ federated: ['p1'] });
		const out = await retractFromFederation(m.holosphere, 'h1', 'quests', '');
		expect(m.del).not.toHaveBeenCalled();
		expect(out.errors.join(' ')).toMatch(/itemId/);
	});
});
