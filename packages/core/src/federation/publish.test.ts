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
} {
	const put = vi.fn(async () => {
		if (opts.putError) throw opts.putError;
	});
	const propagate = vi.fn(async () => opts.propagateResult ?? { success: 0 });
	const createHologram = vi.fn(async (_h: string, _l: string, item: any) => ({
		_hologram: { isHologram: true },
		...item
	}));

	const holosphere = {
		put,
		propagate,
		createHologram,
		getFederation: vi.fn(async () => ({ federated: opts.federated ?? [] })),
		get: vi.fn(async (_h: string, lens: string) =>
			lens === 'settings' ? { hex: opts.settingsHex ?? null } : null
		),
		isValidH3: () => !!opts.isH3
	} as unknown as HoloSphere;

	return { holosphere, put, propagate, createHologram };
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

	it('partner target writes once via put', async () => {
		const m = mockHolosphere();
		const out = await publishToFederation(ctx(m.holosphere), { kind: 'partner', holonId: 'p1' });
		expect(m.put).toHaveBeenCalledWith('p1', 'quests', expect.any(Object));
		expect(out.publishedTo).toBe(1);
		expect(out.destinations).toEqual(['p1']);
	});

	it('hex target writes to the cell', async () => {
		const m = mockHolosphere();
		const out = await publishToFederation(ctx(m.holosphere), { kind: 'hex', cell: '8928308280fffff' });
		expect(m.put).toHaveBeenCalledWith('8928308280fffff', 'quests', expect.any(Object));
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
		expect(out.publishedTo).toBe(3); // hex-cell + 2 federated
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
