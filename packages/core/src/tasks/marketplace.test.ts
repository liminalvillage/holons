import { describe, it, expect } from 'vitest';
import { classifyMarketItem, createMarketItem } from './marketplace.js';

describe('classifyMarketItem', () => {
	it('returns the kind for marketplace types', () => {
		expect(classifyMarketItem({ type: 'offer' })).toBe('offer');
		expect(classifyMarketItem({ type: 'request' })).toBe('request');
		expect(classifyMarketItem({ type: 'need' })).toBe('need');
	});

	it('returns null for non-marketplace quests', () => {
		expect(classifyMarketItem({ type: 'task' })).toBeNull();
		expect(classifyMarketItem({ type: 'event' })).toBeNull();
		expect(classifyMarketItem({ type: 'recurring' })).toBeNull();
		expect(classifyMarketItem({})).toBeNull();
	});

	it('returns null for nullish / non-object input', () => {
		expect(classifyMarketItem(null)).toBeNull();
		expect(classifyMarketItem(undefined)).toBeNull();
		expect(classifyMarketItem('offer')).toBeNull();
	});
});

describe('createMarketItem', () => {
	const initiator = { id: 235114395, username: 'robertovalenti', firstName: 'Roberto' };

	it('builds an offer with exchange_type offer and an empty id', () => {
		const item = createMarketItem({
			holonId: 'demo123',
			initiator,
			kind: 'offer',
			title: 'Pruning know-how',
			now: 1_700_000_000_000,
		});
		expect(item.type).toBe('offer');
		expect(item.exchange_type).toBe('offer');
		expect(item.title).toBe('Pruning know-how');
		expect(item.id).toBe('');
		expect(item.participants).toEqual([]);
		expect(item.initiator).toEqual(initiator);
		expect(item.created).toBe(new Date(1_700_000_000_000).toISOString());
	});

	it('maps request and need to exchange_type want', () => {
		expect(createMarketItem({ holonId: 'h', initiator, kind: 'request', title: 'r' }).exchange_type).toBe('want');
		expect(createMarketItem({ holonId: 'h', initiator, kind: 'need', title: 'n' }).exchange_type).toBe('want');
	});

	it('attaches optional marketplace fields only when provided', () => {
		const full = createMarketItem({
			holonId: 'h',
			initiator,
			kind: 'request',
			title: 'Borrow a laser level',
			description: 'For the new swale',
			itemType: 'good',
			transactionTypes: ['borrow-lend'],
			tags: ['tools'],
			expiresAt: 1_800_000_000_000,
		});
		expect(full.description).toBe('For the new swale');
		expect(full.item_type).toBe('good');
		expect(full.transaction_type).toEqual(['borrow-lend']);
		expect(full.tags).toEqual(['tools']);
		expect(full.expires_at).toBe(1_800_000_000_000);

		const bare = createMarketItem({ holonId: 'h', initiator, kind: 'offer', title: 'x' });
		expect(bare.item_type).toBeUndefined();
		expect(bare.transaction_type).toBeUndefined();
		expect(bare.tags).toBeUndefined();
		expect(bare.expires_at).toBeUndefined();
		expect(bare.description).toBeUndefined();
	});

	it('does not attach empty transactionTypes / tags arrays', () => {
		const item = createMarketItem({
			holonId: 'h',
			initiator,
			kind: 'offer',
			title: 'x',
			transactionTypes: [],
			tags: [],
		});
		expect(item.transaction_type).toBeUndefined();
		expect(item.tags).toBeUndefined();
	});
});
