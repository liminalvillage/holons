import { describe, expect, it, vi } from 'vitest';
import { publishToFederation } from './publish.js';
import type { HoloSphere } from 'holosphere';

interface MockOpts {
	federated?: string[];
	settingsHex?: string | null;
	isH3?: boolean;
	propagateResult?: any;
	putError?: Error;
}

function mockHolosphere(opts: MockOpts = {}): {
	holosphere: HoloSphere;
	put: ReturnType<typeof vi.fn>;
	propagate: ReturnType<typeof vi.fn>;
	createHologram: ReturnType<typeof vi.fn>;
	getNodeRef: ReturnType<typeof vi.fn>;
	cascadeRegistrations: string[];
} {
	const put = vi.fn(async () => {
		if (opts.putError) throw opts.putError;
	});
	const propagate = vi.fn(async () => opts.propagateResult ?? { success: 0 });
	const createHologram = vi.fn(async (_h: string, _l: string, item: any) => ({
		_hologram: { isHologram: true },
		...item
	}));

	// Track every `getNodeRef(soul).get('_holograms').get(newSoul).put(true)`
	// chain triggered by the forwarder-side cascade registration so tests
	// can assert it fired on the right pair of souls.
	const cascadeRegistrations: string[] = [];
	const getNodeRef = vi.fn((soul: string) => ({
		get: (k1: string) => ({
			get: (k2: string) => ({
				put: (_v: any) => {
					cascadeRegistrations.push(`${soul}/${k1}/${k2}`);
				},
			}),
		}),
	}));

	const holosphere = {
		put,
		propagate,
		createHologram,
		getNodeRef,
		appname: 'test-app',
		getFederation: vi.fn(async () => ({ federated: opts.federated ?? [] })),
		get: vi.fn(async (_h: string, lens: string) =>
			lens === 'settings' ? { hex: opts.settingsHex ?? null } : null
		),
		// A configured settings hex counts as a valid cell — readSettingsHex now
		// validates with isValidH3 to filter legacy CSS-color defaults.
		isValidH3: (id: string) => !!opts.isH3 || (!!opts.settingsHex && id === opts.settingsHex)
	} as unknown as HoloSphere;

	return { holosphere, put, propagate, createHologram, getNodeRef, cascadeRegistrations };
}

const ctx = (holosphere: HoloSphere) => ({
	holosphere,
	holonId: 'home-holon',
	lens: 'quests',
	item: { id: 'q-1', title: 'Test' }
});

describe('publishToFederation', () => {
	it('throws when item.id is missing', async () => {
		const { holosphere } = mockHolosphere();
		await expect(
			publishToFederation(
				{ ...ctx(holosphere), item: {} as any },
				{ kind: 'partner', holonId: 'p1' }
			)
		).rejects.toThrow(/item\.id is required/);
	});

	it('partner target writes a full copy by default (holograms opt-in)', async () => {
		const m = mockHolosphere();
		const out = await publishToFederation(ctx(m.holosphere), { kind: 'partner', holonId: 'p1' });
		// Default: no hologram is minted; the receiver gets the full item.
		expect(m.createHologram).not.toHaveBeenCalled();
		expect(m.put).toHaveBeenCalledWith('p1', 'quests', { id: 'q-1', title: 'Test' });
		expect(out.publishedTo).toBe(1);
		expect(out.destinations).toEqual(['p1']);
		expect(out.usedHolograms).toBe(false);
	});

	it('partner target with useHolograms writes a bare {id,soul} hologram', async () => {
		const m = mockHolosphere();
		const out = await publishToFederation(
			ctx(m.holosphere),
			{ kind: 'partner', holonId: 'p1' },
			{ useHolograms: true }
		);
		expect(m.createHologram).toHaveBeenCalledOnce();
		expect(m.put).toHaveBeenCalledWith('p1', 'quests', expect.objectContaining({ id: 'q-1' }));
		expect(out.usedHolograms).toBe(true);
	});

	it('hex target writes to the cell', async () => {
		const m = mockHolosphere();
		const out = await publishToFederation(ctx(m.holosphere), { kind: 'hex', cell: '8928308280fffff' });
		expect(m.put).toHaveBeenCalledWith('8928308280fffff', 'quests', expect.any(Object));
		expect(out.destinations).toEqual(['8928308280fffff']);
	});

	it('hex target with upcast propagates up the parent chain', async () => {
		const m = mockHolosphere();
		const out = await publishToFederation(
			ctx(m.holosphere),
			{ kind: 'hex', cell: '8928308280fffff' },
			{ upcast: true, upcastLevels: 8 }
		);
		expect(m.put).toHaveBeenCalledWith(
			'8928308280fffff',
			'quests',
			expect.any(Object),
			expect.objectContaining({
				autoPropagate: true,
				propagationOptions: expect.objectContaining({
					propagateToParents: true,
					maxParentLevels: 8
				})
			})
		);
		expect(out.destinations).toEqual(['8928308280fffff']);
	});

	it('all target propagates and writes to settings.hex', async () => {
		const m = mockHolosphere({
			federated: ['p1', 'p2'],
			settingsHex: 'hex-cell',
			propagateResult: { success: 2, messages: [] }
		});
		const out = await publishToFederation(ctx(m.holosphere), { kind: 'all' });
		expect(m.put).toHaveBeenCalledWith('hex-cell', 'quests', expect.any(Object));
		expect(m.propagate).toHaveBeenCalledOnce();
		// Default propagates full copies, not holograms.
		expect(m.propagate).toHaveBeenCalledWith(
			'home-holon',
			'quests',
			expect.any(Object),
			expect.objectContaining({ useHolograms: false })
		);
		expect(out.publishedTo).toBe(3); // hex-cell + 2 federated
		expect(out.usedHolograms).toBe(false);
	});

	it('all target with useHolograms propagates holograms', async () => {
		const m = mockHolosphere({
			federated: ['p1'],
			propagateResult: { success: 1, messages: [] }
		});
		const out = await publishToFederation(ctx(m.holosphere), { kind: 'all' }, { useHolograms: true });
		expect(m.propagate).toHaveBeenCalledWith(
			'home-holon',
			'quests',
			expect.any(Object),
			expect.objectContaining({ useHolograms: true })
		);
		expect(out.usedHolograms).toBe(true);
	});

	it('all target skips settings.hex when includeSettingsHex is false', async () => {
		const m = mockHolosphere({ federated: [], settingsHex: 'hex-cell' });
		const out = await publishToFederation(
			ctx(m.holosphere),
			{ kind: 'all' },
			{ includeSettingsHex: false }
		);
		expect(m.put).not.toHaveBeenCalled();
		expect(out.publishedTo).toBe(0);
	});

	it('all target skips propagate when no federated partners', async () => {
		const m = mockHolosphere({ federated: [] });
		const out = await publishToFederation(ctx(m.holosphere), { kind: 'all' });
		expect(m.propagate).not.toHaveBeenCalled();
		expect(out.publishedTo).toBe(0);
	});

	it('write-denied errors fire onWriteDenied callback', async () => {
		const m = mockHolosphere({ putError: Object.assign(new Error('Write access denied'), {}) });
		const onWriteDenied = vi.fn();
		const out = await publishToFederation(
			ctx(m.holosphere),
			{ kind: 'partner', holonId: 'p1' },
			{ onWriteDenied }
		);
		expect(onWriteDenied).toHaveBeenCalledOnce();
		expect(out.errors[0]).toMatch(/write denied/);
		expect(out.publishedTo).toBe(0);
	});

	it('forwards an existing hologram as a soul pointer back to the original source', async () => {
		const m = mockHolosphere();
		const forwardedItem = {
			id: 'q-1',
			title: 'Forwarded',
			_hologram: {
				isHologram: true,
				sourceHolon: 'origin-holon',
				soul: 'app/origin-holon/quests/q-1',
			},
		};
		const out = await publishToFederation(
			{ ...ctx(m.holosphere), item: forwardedItem as any },
			{ kind: 'partner', holonId: 'p1' },
			{ useHolograms: true },
		);

		// The receiver should get the *bare stored hologram shape*
		// (`{ id, soul }`) pointing at the original source — NOT the full
		// resolved object (whose `_hologram` envelope would be stripped by
		// holosphere.put, leaving the receiver with a plain task and no
		// link back to the source) and NOT a freshly-minted soul pointing
		// at the forwarder's storage (createHologram's default behaviour
		// when it doesn't recognise the input as already-a-hologram).
		expect(m.createHologram).not.toHaveBeenCalled();
		expect(m.put).toHaveBeenCalledWith('p1', 'quests', {
			id: 'q-1',
			soul: 'app/origin-holon/quests/q-1',
		});
		expect(out.publishedTo).toBe(1);

		// And the forwarder must also register the new hop in ITS OWN
		// `_holograms` set so updates from the original source cascade
		// through us to the new hop, even when the cross-holon write to
		// the original source's `_holograms` set doesn't make it across
		// the Gun mesh.
		expect(m.cascadeRegistrations).toContain(
			'test-app/home-holon/quests/q-1/_holograms/test-app/p1/quests/q-1',
		);
	});

	it('skips forwarder-side _holograms cascade on a fresh publish (not a forward)', async () => {
		const m = mockHolosphere();
		await publishToFederation(ctx(m.holosphere), { kind: 'partner', holonId: 'p1' });
		// Fresh publishes don't need the extra local registration — holosphere's
		// own put already registers the new hologram at the source's set on the
		// same local instance.
		expect(m.cascadeRegistrations).toEqual([]);
	});

	it('h3 home holon enables propagateToParents', async () => {
		const m = mockHolosphere({ federated: ['p1'], isH3: true });
		await publishToFederation(ctx(m.holosphere), { kind: 'all' });
		expect(m.propagate).toHaveBeenCalledWith(
			'home-holon',
			'quests',
			expect.any(Object),
			expect.objectContaining({ propagateToParents: true, maxParentLevels: 1 })
		);
	});
});
