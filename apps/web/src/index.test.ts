import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock SvelteKit modules that require runtime context
vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/stores', () => ({
	page: { subscribe: vi.fn((fn: any) => { fn({ url: new URL('http://localhost'), params: {} }); return () => {}; }) }
}));

// ============================================================================
// Mock HoloSphere — lightweight mock matching the holosphere2 nostr-only API
// ============================================================================

function createMockHoloSphere(overrides?: Partial<Record<string, any>>) {
	const storage = new Map<string, any>();
	const globalStorage = new Map<string, Map<string, any>>();
	const federationData = new Map<string, { federated: string[]; lensConfig: Record<string, any>; partnerNames: Record<string, string> }>();

	return {
		client: { publicKey: 'a'.repeat(64) },
		config: { appName: 'test' },

		// CRUD
		async write(holonId: string, lens: string, data: any) {
			const key = `${holonId}:${lens}:${data.id}`;
			storage.set(key, data);
			return true;
		},
		async read(holonId: string, lens: string, dataId?: string) {
			if (dataId) return storage.get(`${holonId}:${lens}:${dataId}`) || null;
			return null;
		},
		async getAll(holonId: string, lens: string) {
			const items: any[] = [];
			for (const [key, value] of storage) {
				if (key.startsWith(`${holonId}:${lens}:`)) items.push(value);
			}
			return items;
		},
		async delete(holonId: string, lens: string, dataId: string) {
			return storage.delete(`${holonId}:${lens}:${dataId}`);
		},

		// Aliases
		async put(holonId: string, lens: string, data: any) {
			return this.write(holonId, lens, data);
		},
		async get(holonId: string, lens: string, dataId?: string) {
			return this.read(holonId, lens, dataId);
		},

		// Global tables
		async writeGlobal(table: string, data: any) {
			if (!globalStorage.has(table)) globalStorage.set(table, new Map());
			globalStorage.get(table)!.set(data.id, data);
		},
		async getGlobal(table: string, key?: string) {
			if (!globalStorage.has(table)) return null;
			if (key) return globalStorage.get(table)!.get(key) || null;
			return Array.from(globalStorage.get(table)!.values());
		},
		async getAllGlobal(table: string) {
			if (!globalStorage.has(table)) return [];
			return Array.from(globalStorage.get(table)!.values());
		},

		// Subscriptions
		subscribe(holonId: string, lens: string, callback: Function) {
			return { unsubscribe: vi.fn() };
		},
		async subscribeGlobal(table: string, key: string, callback: Function) {
			return { unsubscribe: vi.fn() };
		},

		// Federation
		async getFederation(holonId: string) {
			return federationData.get(holonId) || null;
		},
		async federateHolon(sourceHolon: string, targetHolon: string, options?: any) {
			if (!federationData.has(sourceHolon)) {
				federationData.set(sourceHolon, { federated: [], lensConfig: {}, partnerNames: {} });
			}
			const fed = federationData.get(sourceHolon)!;
			if (!fed.federated.includes(targetHolon)) {
				fed.federated.push(targetHolon);
			}
			if (options?.lensConfig) {
				fed.lensConfig[targetHolon] = options.lensConfig;
			}
			if (options?.partnerName) {
				fed.partnerNames[targetHolon] = options.partnerName;
			}
			return true;
		},
		async unfederateHolon(sourceHolon: string, targetHolon: string) {
			const fed = federationData.get(sourceHolon);
			if (fed) {
				fed.federated = fed.federated.filter(id => id !== targetHolon);
				delete fed.lensConfig[targetHolon];
				delete fed.partnerNames[targetHolon];
			}
			return true;
		},
		async isFederated(pubKey: string) {
			for (const [, fed] of federationData) {
				if (fed.federated.includes(pubKey)) return true;
			}
			return false;
		},

		// Share protocol (cross-author federation)
		async share(targetPubKey: string, lens: string, itemId?: string) {
			return { success: true };
		},
		async accept(sharePayload: any, senderPubKey: string) {
			return { success: true };
		},
		async reject(sharePayload: any, senderPubKey: string) {
			return { success: true };
		},

		// Access control
		async canWrite(holonId: string, lens: string, writerPubKey: string) {
			return { canWrite: writerPubKey === this.client.publicKey, reason: 'owner', accessType: 'owner' };
		},

		// Encryption stubs
		async shareLensKeys(partnerPubKey: string, lensNames?: string[]) {
			return { shared: lensNames?.length || 0, failed: 0, lenses: lensNames || [] };
		},
		hasLensKey(holonId: string, lensName: string) { return false; },
		getEncryptionStats() { return { ownKeyCount: 0, receivedKeyCount: 0, totalPartnerGrants: 0 }; },

		// Registration
		async registerHolon(holonId: string, publicKey: string) { return true; },
		async lookupHolon(holonId: string) { return null; },

		// Utilities
		async ready() {},
		close() {},
		metrics() { return { writes: 0, reads: 0, subscriptions: 0 }; },

		// Expose internals for test assertions
		_storage: storage,
		_globalStorage: globalStorage,
		_federationData: federationData,

		...overrides
	};
}

// ============================================================================
// Tests: HoloSphere2 CRUD Operations
// ============================================================================

describe('HoloSphere2 CRUD Operations', () => {
	let hs: ReturnType<typeof createMockHoloSphere>;

	beforeEach(() => {
		hs = createMockHoloSphere();
	});

	it('write and read a lens item', async () => {
		await hs.write('holon1', 'quests', { id: 'q1', title: 'Test Quest' });
		const result = await hs.read('holon1', 'quests', 'q1');
		expect(result).toEqual({ id: 'q1', title: 'Test Quest' });
	});

	it('put/get aliases work the same as write/read', async () => {
		await hs.put('holon1', 'settings', { id: 'holon1', name: 'My Holon' });
		const result = await hs.get('holon1', 'settings', 'holon1');
		expect(result).toEqual({ id: 'holon1', name: 'My Holon' });
	});

	it('getAll returns all items for a lens', async () => {
		await hs.write('holon1', 'quests', { id: 'q1', title: 'Quest 1' });
		await hs.write('holon1', 'quests', { id: 'q2', title: 'Quest 2' });
		await hs.write('holon1', 'offers', { id: 'o1', title: 'Offer 1' });

		const quests = await hs.getAll('holon1', 'quests');
		expect(quests).toHaveLength(2);
		expect(quests.map((q: any) => q.id).sort()).toEqual(['q1', 'q2']);
	});

	it('delete removes an item', async () => {
		await hs.write('holon1', 'quests', { id: 'q1', title: 'Test' });
		expect(await hs.read('holon1', 'quests', 'q1')).toBeTruthy();

		await hs.delete('holon1', 'quests', 'q1');
		expect(await hs.read('holon1', 'quests', 'q1')).toBeNull();
	});

	it('read returns null for non-existent items', async () => {
		const result = await hs.read('holon1', 'quests', 'nonexistent');
		expect(result).toBeNull();
	});
});

// ============================================================================
// Tests: Global Table Operations
// ============================================================================

describe('HoloSphere2 Global Table Operations', () => {
	let hs: ReturnType<typeof createMockHoloSphere>;

	beforeEach(() => {
		hs = createMockHoloSphere();
	});

	it('writeGlobal and getGlobal for HNS-style registry', async () => {
		const entry = { id: 'abc123', holonId: 'abc123', name: 'Test Holon', timestamp: Date.now(), signature: 'sig' };
		await hs.writeGlobal('hns', entry);

		const result = await hs.getGlobal('hns', 'abc123');
		expect(result).toEqual(entry);
	});

	it('getAllGlobal returns all entries in a table', async () => {
		await hs.writeGlobal('hns', { id: 'a', name: 'Alice' });
		await hs.writeGlobal('hns', { id: 'b', name: 'Bob' });

		const all = await hs.getAllGlobal('hns');
		expect(all).toHaveLength(2);
	});

	it('getGlobal returns null for missing key', async () => {
		const result = await hs.getGlobal('hns', 'nonexistent');
		expect(result).toBeNull();
	});
});

// ============================================================================
// Tests: Federation Lifecycle
// ============================================================================

describe('HoloSphere2 Federation Lifecycle', () => {
	let hs: ReturnType<typeof createMockHoloSphere>;
	const myHolon = 'a'.repeat(64);
	const partnerHolon = 'b'.repeat(64);

	beforeEach(() => {
		hs = createMockHoloSphere();
	});

	it('federateHolon creates a bidirectional federation with lens config', async () => {
		const result = await hs.federateHolon(myHolon, partnerHolon, {
			lensConfig: { lenses: ['quests', 'offers'] },
			partnerName: 'Partner Holon'
		});
		expect(result).toBe(true);

		const federation = await hs.getFederation(myHolon);
		expect(federation).not.toBeNull();
		expect(federation!.federated).toContain(partnerHolon);
		expect(federation!.lensConfig[partnerHolon].lenses).toEqual(['quests', 'offers']);
		expect(federation!.partnerNames[partnerHolon]).toBe('Partner Holon');
	});

	it('unfederateHolon removes the federation', async () => {
		await hs.federateHolon(myHolon, partnerHolon, {
			lensConfig: { lenses: ['quests'] }
		});
		expect((await hs.getFederation(myHolon))!.federated).toContain(partnerHolon);

		await hs.unfederateHolon(myHolon, partnerHolon);
		const federation = await hs.getFederation(myHolon);
		expect(federation!.federated).not.toContain(partnerHolon);
	});

	it('getFederation returns null for non-federated holon', async () => {
		const result = await hs.getFederation('nonexistent');
		expect(result).toBeNull();
	});

	it('federateHolon is idempotent (no duplicate entries)', async () => {
		await hs.federateHolon(myHolon, partnerHolon, { lensConfig: { lenses: ['quests'] } });
		await hs.federateHolon(myHolon, partnerHolon, { lensConfig: { lenses: ['quests', 'offers'] } });

		const federation = await hs.getFederation(myHolon);
		expect(federation!.federated.filter(id => id === partnerHolon)).toHaveLength(1);
		// Second call should update lens config
		expect(federation!.lensConfig[partnerHolon].lenses).toEqual(['quests', 'offers']);
	});
});

// ============================================================================
// Tests: Subscription Management
// ============================================================================

describe('HoloSphere2 Subscription Management', () => {
	it('subscribe returns an object with unsubscribe', () => {
		const hs = createMockHoloSphere();
		const sub = hs.subscribe('holon1', 'quests', () => {});
		expect(sub).toHaveProperty('unsubscribe');
		expect(typeof sub.unsubscribe).toBe('function');
	});

	it('subscribeGlobal returns an object with unsubscribe', async () => {
		const hs = createMockHoloSphere();
		const sub = await hs.subscribeGlobal('federation', 'holon1', () => {});
		expect(sub).toHaveProperty('unsubscribe');
		expect(typeof sub.unsubscribe).toBe('function');
	});
});

// ============================================================================
// Tests: Encryption API Surface
// ============================================================================

describe('HoloSphere2 Encryption API', () => {
	it('shareLensKeys returns shared/failed counts', async () => {
		const hs = createMockHoloSphere();
		const result = await hs.shareLensKeys('b'.repeat(64), ['quests', 'offers']);
		expect(result.shared).toBe(2);
		expect(result.failed).toBe(0);
		expect(result.lenses).toEqual(['quests', 'offers']);
	});

	it('getEncryptionStats returns key counts', () => {
		const hs = createMockHoloSphere();
		const stats = hs.getEncryptionStats();
		expect(stats).toHaveProperty('ownKeyCount');
		expect(stats).toHaveProperty('receivedKeyCount');
		expect(stats).toHaveProperty('totalPartnerGrants');
	});

	it('hasLensKey checks for lens encryption key', () => {
		const hs = createMockHoloSphere();
		expect(hs.hasLensKey('holon1', 'secrets')).toBe(false);
	});
});

// ============================================================================
// Tests: Access Control
// ============================================================================

describe('HoloSphere2 Access Control', () => {
	it('canWrite returns true for owner', async () => {
		const hs = createMockHoloSphere();
		const result = await hs.canWrite('holon1', 'quests', hs.client.publicKey);
		expect(result.canWrite).toBe(true);
	});

	it('canWrite returns false for non-owner', async () => {
		const hs = createMockHoloSphere();
		const result = await hs.canWrite('holon1', 'quests', 'b'.repeat(64));
		expect(result.canWrite).toBe(false);
	});
});

// ============================================================================
// Tests: QueryManager (app-level caching layer)
// ============================================================================

describe('QueryManager', () => {
	it('caches queries and deduplicates requests', async () => {
		const { queryManager: qm } = await import('./lib/holosphere/QueryManager');
		qm.clear(); // Reset singleton state

		const mockHs = createMockHoloSphere();
		await mockHs.write('holon1', 'quests', { id: 'q1', title: 'Quest' });
		qm.init(mockHs as any);

		const result1 = await qm.query('holon1', 'quests');
		expect(result1).toHaveLength(1);

		// Second call should use cache
		const result2 = await qm.query('holon1', 'quests');
		expect(result2).toHaveLength(1);

		const stats = qm.getStats();
		expect(stats.cacheSize).toBe(1);
		qm.clear();
	});

	it('invalidate forces refetch with fresh data', async () => {
		const { queryManager: qm } = await import('./lib/holosphere/QueryManager');
		qm.clear();

		const holonId = 'invalidate-test-holon';
		const mockHs = createMockHoloSphere();
		await mockHs.write(holonId, 'quests', { id: 'q1', title: 'Quest' });
		qm.init(mockHs as any);

		const result1 = await qm.query(holonId, 'quests');
		expect(result1).toHaveLength(1);

		// Wait for dedup window to expire, then add item and invalidate
		await new Promise(r => setTimeout(r, 250));
		await mockHs.write(holonId, 'quests', { id: 'q2', title: 'Quest 2' });
		qm.invalidate(holonId, 'quests');

		const result2 = await qm.query(holonId, 'quests');
		expect(result2).toHaveLength(2);
		qm.clear();
	});

	it('filters out deleted and id-less items', async () => {
		// Note: unresolved-hologram error stubs used to leak through here
		// and we filtered them client-side. Holosphere now filters them at
		// the `getFederated` boundary (federation.js `isResolved`), so
		// QueryManager only needs to drop tombstones + id-less rows.
		const { queryManager: qm } = await import('./lib/holosphere/QueryManager');
		qm.clear();

		const mockHs = createMockHoloSphere({
			async getAll() {
				return [
					{ id: 'valid', title: 'Good' },
					{ id: 'deleted', title: 'Bad', _deleted: true },
					{ id: null }, // invalid
				];
			}
		});
		qm.init(mockHs as any);

		const result = await qm.query('holon1', 'quests');
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('valid');
		qm.clear();
	});
});

// ============================================================================
// Tests: Federation Request Store (app-level localStorage persistence)
// ============================================================================

describe('Federation Request Store', () => {
	it('createIncomingRequest creates correct structure', async () => {
		const { createIncomingRequest } = await import('./lib/stores/federationRequests');
		const req = createIncomingRequest(
			'req-1', 'sender-pub', 'npub1...', 'holon-1', 'Alice Holon',
			{ lenses: ['quests', 'offers'] },
			[],
			'Hello!'
		);

		expect(req.id).toBe('req-1');
		expect(req.type).toBe('incoming');
		expect(req.status).toBe('pending');
		expect(req.senderHolonName).toBe('Alice Holon');
		expect(req.lensConfig.lenses).toEqual(['quests', 'offers']);
		expect(req.message).toBe('Hello!');
	});

	it('createOutgoingRequest includes recipient info', async () => {
		const { createOutgoingRequest } = await import('./lib/stores/federationRequests');
		const req = createOutgoingRequest(
			'req-2', 'my-pub', 'npub1me', 'my-holon', 'My Holon',
			'partner-pub', 'npub1partner',
			{ lenses: ['quests'] },
			[],
			'Let us federate',
			'Partner Holon'
		);

		expect(req.id).toBe('req-2');
		expect(req.type).toBe('outgoing');
		expect(req.recipientPubKey).toBe('partner-pub');
		expect(req.recipientHolonName).toBe('Partner Holon');
	});

	it('createIncomingUpdate and createOutgoingUpdate', async () => {
		const { createIncomingUpdate, createOutgoingUpdate } = await import('./lib/stores/federationRequests');

		const incoming = createIncomingUpdate(
			'upd-1', 'partner-pub', 'npub1...', 'partner-holon', 'Partner',
			{ lenses: ['quests'] },
			{ lenses: ['quests', 'offers'] }
		);
		expect(incoming.type).toBe('incoming_update');
		expect(incoming.newLensConfig.lenses).toEqual(['quests', 'offers']);

		const outgoing = createOutgoingUpdate(
			'upd-2', 'partner-pub', 'npub1...', 'partner-holon', 'Partner',
			{ lenses: ['quests'] },
			{ lenses: ['quests', 'offers'] }
		);
		expect(outgoing.type).toBe('outgoing_update');
	});
});

// ============================================================================
// Tests: HoloSphere Write with Identity (app-level wrapper)
// ============================================================================

describe('writeWithIdentity', () => {
	it('passes actingAs from activeHolonIdentity store', async () => {
		const writeCalls: any[] = [];
		const mockHs = createMockHoloSphere({
			async put(holonId: string, lens: string, data: any, options?: any) {
				writeCalls.push({ holonId, lens, data, options });
				return true;
			}
		});

		const { writeWithIdentity } = await import('./lib/holosphereWrite');
		const result = await writeWithIdentity(mockHs as any, 'holon1', 'quests', { id: 'q1', title: 'Test' });
		expect(result).toBe(true);
		expect(writeCalls).toHaveLength(1);
		expect(writeCalls[0].holonId).toBe('holon1');
		expect(writeCalls[0].lens).toBe('quests');
	});

	it('returns false and notifies on AuthorizationError', async () => {
		const mockHs = createMockHoloSphere({
			async put() {
				const err = new Error('Write access denied');
				err.name = 'AuthorizationError';
				throw err;
			}
		});

		const { writeWithIdentity } = await import('./lib/holosphereWrite');
		const result = await writeWithIdentity(mockHs as any, 'holon1', 'quests', { id: 'q1' }, { silent: true });
		expect(result).toBe(false);
	});
});

// ============================================================================
// Tests: Lens Capability Utilities
// ============================================================================

describe('Lens Capability Utilities', () => {
	it('generateCapabilityId creates deterministic ID', async () => {
		const { generateCapabilityId } = await import('./lib/capabilities/lensCapability');
		const id = generateCapabilityId('issuer', 'recipient', 'holon1', 'quests');
		expect(id).toBe('issuer_recipient_holon1_quests');
	});

	it('getExpirationTimestamp returns correct values', async () => {
		const { getExpirationTimestamp } = await import('./lib/capabilities/lensCapability');
		expect(getExpirationTimestamp('permanent')).toBeNull();
		expect(getExpirationTimestamp('30days')).toBeGreaterThan(Date.now());
		expect(getExpirationTimestamp('1year')).toBeGreaterThan(Date.now() + 300 * 24 * 60 * 60 * 1000);
	});

	it('isCapabilityValid checks expiry and revocation', async () => {
		const { isCapabilityValid } = await import('./lib/capabilities/lensCapability');

		const validToken = { expiresAt: Date.now() + 100000 } as any;
		expect(isCapabilityValid(validToken)).toBe(true);

		const expiredToken = { expiresAt: Date.now() - 1000 } as any;
		expect(isCapabilityValid(expiredToken)).toBe(false);

		const revokedToken = { expiresAt: null, revokedAt: Date.now() } as any;
		expect(isCapabilityValid(revokedToken)).toBe(false);
	});
});
