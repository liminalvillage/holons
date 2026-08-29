// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A booking made from a partner holon must say so on the OWNER's record.
// Federation redirects the write to the item's holon (`sourceRef`), so without
// this stamp the owner sees a booking by a stranger with no way to tell where
// it came from.
import { describe, expect, it } from 'vitest';
import { bookItem, borrowItem } from './operations.js';
import { bookingOriginFor, bookingOriginLabel, isFederatedBooking, makeBooking } from './bookings.js';
import type { LibraryItem } from './types.js';

// Dates relative to today, so the "booking window must not be in the past"
// rule never turns these tests stale as the calendar moves on.
const iso = (daysFromNow: number) =>
	new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const START = iso(1);
const END = iso(8);


const OWNER = '-1003864542239';   // holon that owns the item
const GUEST = '-1002964866719';   // holon the borrower is working in

function db(item: LibraryItem | null) {
	const store: Record<string, unknown> = {};
	return {
		get: async () => item,
		put: async (_h: string, _l: string, v: unknown) => { store.last = v; },
		store
	};
}

const item = (): LibraryItem => ({ id: 'Chainsaw', type: 'tool' }) as LibraryItem;
const actor = { id: 1578071183, username: 'alexlionyes1', first_name: 'Alex' };

describe('bookingOriginFor', () => {
	it('is null when the borrower is in the item\'s own holon', () => {
		expect(bookingOriginFor(OWNER, OWNER)).toBeNull();
	});

	it('is null when the surface reports no acting holon', () => {
		expect(bookingOriginFor(OWNER, null)).toBeNull();
		expect(bookingOriginFor(OWNER, '')).toBeNull();
	});

	it('names the partner holon when they differ', () => {
		expect(bookingOriginFor(OWNER, GUEST, 'Casaselva')).toEqual({
			holon: GUEST,
			name: 'Casaselva'
		});
	});

	it('compares as strings, so a numeric holon id still matches itself', () => {
		expect(bookingOriginFor('123', 123)).toBeNull();
	});
});

describe('makeBooking', () => {
	it('omits the origin fields entirely for a local booking', () => {
		const b = makeBooking(actor, START, END, null);
		expect('viaHolon' in b).toBe(false);
		expect('viaHolonName' in b).toBe(false);
		expect(isFederatedBooking(b)).toBe(false);
	});

	it('stamps the origin for a federated booking', () => {
		const b = makeBooking(actor, START, END, { holon: GUEST, name: 'Casaselva' });
		expect(b.viaHolon).toBe(GUEST);
		expect(b.viaHolonName).toBe('Casaselva');
		expect(isFederatedBooking(b)).toBe(true);
		expect(bookingOriginLabel(b)).toBe('Casaselva');
	});

	it('falls back to the holon id when the name is unresolved', () => {
		const b = makeBooking(actor, START, END, { holon: GUEST });
		expect(bookingOriginLabel(b)).toBe(GUEST);
	});
});

describe('bookItem — federated origin', () => {
	it('stamps the acting holon on the owner\'s booking', async () => {
		const res = await bookItem(
			db(item()) as never,
			OWNER,
			'Chainsaw',
			actor,
			{ start: START, end: END },
			{ actingHolon: GUEST, actingHolonName: 'Casaselva' }
		);
		expect(res.ok).toBe(true);
		expect(res.booking?.viaHolon).toBe(GUEST);
		expect(res.booking?.viaHolonName).toBe('Casaselva');
		// It lands on the stored item too, not just the returned booking.
		expect(res.item?.bookings?.[0].viaHolon).toBe(GUEST);
	});

	it('leaves a same-holon booking unstamped', async () => {
		const res = await bookItem(
			db(item()) as never,
			OWNER,
			'Chainsaw',
			actor,
			{ start: START, end: END },
			{ actingHolon: OWNER, actingHolonName: 'Liminal' }
		);
		expect(res.ok).toBe(true);
		expect(isFederatedBooking(res.booking)).toBe(false);
	});

	it('leaves callers that pass no context unchanged', async () => {
		const res = await bookItem(
			db(item()) as never, OWNER, 'Chainsaw', actor, { end: END }
		);
		expect(res.ok).toBe(true);
		expect(isFederatedBooking(res.booking)).toBe(false);
	});
});

describe('borrowItem — federated origin', () => {
	it('passes the context through to the booking', async () => {
		const res = await borrowItem(
			db(item()) as never,
			OWNER,
			'Chainsaw',
			actor,
			END,
			{ actingHolon: GUEST, actingHolonName: 'Casaselva' }
		);
		expect(res.ok).toBe(true);
		expect(res.booking?.viaHolon).toBe(GUEST);
	});
});
