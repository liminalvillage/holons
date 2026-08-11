// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { migrateLegacyFederationLinks } from './legacy.js';
import type { HoloSphere } from 'holosphere';

function mockHolosphere(settings: any, native: any = null) {
	return {
		get: vi.fn(async () => settings),
		put: vi.fn(async () => undefined),
		getFederation: vi.fn(async () => native),
		federateHolon: vi.fn(async () => true)
	} as unknown as HoloSphere;
}

const LEGACY_SETTINGS = () => ({
	name: 'Home',
	hex: '8928308280fffff',
	federationZones: { partner: 2 },
	federation: [
		{
			targetId: 'partner',
			targetName: 'Partner',
			relationship: 'federated',
			lenses: { inbound: ['quests'], outbound: [] },
			created: 'x'
		}
	],
	lensConfig: { partner: { inbound: ['quests', 'library'], outbound: ['roles'], created: 'x' } }
});

describe('migrateLegacyFederationLinks', () => {
	it('folds legacy links into the native record, preferring lensConfig lenses', async () => {
		const hs = mockHolosphere(LEGACY_SETTINGS());
		const result = await migrateLegacyFederationLinks(hs, 'home');

		expect(result.migrated).toEqual(['partner']);
		expect((hs as any).federateHolon).toHaveBeenCalledWith('home', 'partner', {
			lensConfig: { inbound: ['quests', 'library'], outbound: ['roles'] },
			partnerName: 'Partner'
		});
	});

	it('strips the legacy fields with explicit nulls and stamps the marker', async () => {
		const hs = mockHolosphere(LEGACY_SETTINGS());
		await migrateLegacyFederationLinks(hs, 'home');

		const saved = (hs as any).put.mock.calls[0][2];
		expect(saved.federation).toBeNull();
		expect(saved.lensConfig).toBeNull();
		expect(typeof saved.federationLinksMigrated).toBe('string');
		// Unrelated settings fields survive.
		expect(saved.name).toBe('Home');
		expect(saved.hex).toBe('8928308280fffff');
		expect(saved.federationZones).toEqual({ partner: 2 });
	});

	it('never overwrites a partner the native record already has', async () => {
		const hs = mockHolosphere(LEGACY_SETTINGS(), {
			federated: ['partner'],
			lensConfig: { partner: { inbound: ['checklists'], outbound: [] } },
			partnerNames: {}
		});
		const result = await migrateLegacyFederationLinks(hs, 'home');

		expect(result.migrated).toEqual([]);
		expect(result.skipped).toEqual(['partner']);
		expect((hs as any).federateHolon).not.toHaveBeenCalled();
		// Fields still stripped so the legacy data can't resurface.
		expect((hs as any).put).toHaveBeenCalled();
	});

	it('migrates lensConfig-only entries (no matching link)', async () => {
		const hs = mockHolosphere({
			lensConfig: { orphan: { inbound: ['quests'], outbound: [], created: 'x' } }
		});
		const result = await migrateLegacyFederationLinks(hs, 'home');
		expect(result.migrated).toEqual(['orphan']);
		expect((hs as any).federateHolon).toHaveBeenCalledWith('home', 'orphan', {
			lensConfig: { inbound: ['quests'], outbound: [] }
		});
	});

	it('is a no-op on migrated, empty, self-only, or missing settings', async () => {
		const marked = mockHolosphere({ federation: [{ targetId: 'p' }], federationLinksMigrated: 'x' });
		expect(await migrateLegacyFederationLinks(marked, 'home')).toEqual({ migrated: [], skipped: [] });
		expect((marked as any).put).not.toHaveBeenCalled();

		const empty = mockHolosphere({ name: 'Home' });
		expect(await migrateLegacyFederationLinks(empty, 'home')).toEqual({ migrated: [], skipped: [] });
		expect((empty as any).put).not.toHaveBeenCalled();

		// A legacy self-link is dropped, not migrated.
		const selfOnly = mockHolosphere({ federation: [{ targetId: 'home' }] });
		expect(await migrateLegacyFederationLinks(selfOnly, 'home')).toEqual({ migrated: [], skipped: [] });

		const missing = mockHolosphere(null);
		expect(await migrateLegacyFederationLinks(missing, 'home')).toEqual({ migrated: [], skipped: [] });
	});
});
