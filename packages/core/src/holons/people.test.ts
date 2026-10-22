// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { findPeople, loadFederationPeople, loadPeopleAcross, peopleAcross } from './people.js';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

describe('peopleAcross', () => {
	it('lists each person once, with every holon they are in', () => {
		const out = peopleAcross([
			{ holon: '-100', members: [{ id: 1, first_name: 'Ada' }, { id: 2 }] },
			{ holon: '-200', members: [{ id: '1' }, { id: 3 }] },
		]);
		expect(out.people.map((p) => [p.id, p.holons])).toEqual([
			['1', ['-100', '-200']],
			['2', ['-100']],
			['3', ['-200']],
		]);
		expect(out.people[0].name).toBe('Ada');
	});

	it('names the connectors and the bridges they make', () => {
		const out = peopleAcross([
			{ holon: 'h1', members: [{ id: 1 }, { id: 2 }, { id: 9 }] },
			{ holon: 'h2', members: [{ id: 1 }, { id: 2 }] },
			{ holon: 'h3', members: [{ id: 1 }] },
		]);
		expect(out.connectors.map((p) => p.id)).toEqual(['1', '2']);
		expect(out.bridges).toEqual([
			{ a: 'h1', b: 'h2', people: ['1', '2'] },
			{ a: 'h1', b: 'h3', people: ['1'] },
			{ a: 'h2', b: 'h3', people: ['1'] },
		]);
	});

	it('folds a linked key into the person behind it', () => {
		const out = peopleAcross(
			[
				{ holon: '-100', members: [{ id: 7, first_name: 'Gio', linkedKeys: [KEY_B] }] },
				{ holon: 'holon_abcdefghijkl', members: [{ id: KEY_A }] },
				{ holon: 'holon_mnopqrstuvwx', members: [{ id: KEY_B.toUpperCase() }] },
			],
			{ identity: new Map([[KEY_A, '7']]) },
		);
		expect(out.people).toHaveLength(1);
		expect(out.people[0]).toMatchObject({
			id: '7',
			name: 'Gio',
			holons: ['-100', 'holon_abcdefghijkl', 'holon_mnopqrstuvwx'],
		});
		expect(out.people[0].ids.sort()).toEqual(['7', KEY_A, KEY_B].sort());
	});

	it('leaves out bots, deleted records, holons and the holon itself', () => {
		const out = peopleAcross([
			{
				holon: '42',
				members: [
					{ id: 42, first_name: 'Self' },
					{ id: 5, is_bot: true },
					{ id: 6, _deleted: true },
					{ id: '-300' },
					{ id: 'holon_abcdefghijkl' },
					null,
					{ first_name: 'No id' },
					{ id: 8 },
				],
			},
		]);
		expect(out.people.map((p) => p.id)).toEqual(['8']);
	});

	it('counts a holon once per person, however often it is given', () => {
		const out = peopleAcross([
			{ holon: 'h1', members: [{ id: 1 }, { id: '1' }] },
			{ holon: 'h1', members: [{ id: 1 }] },
		]);
		expect(out.people[0].holons).toEqual(['h1']);
		expect(out.connectors).toEqual([]);
	});
});

describe('loadPeopleAcross', () => {
	it('reads each roster once and survives one that cannot be read', async () => {
		const getAll = vi.fn(async (holon: string) => {
			if (holon === 'bad') throw new Error('relay unreachable');
			if (holon === 'h1') return [{ id: 1 }, { id: 2 }];
			return { x: { id: 1 } };
		});
		const out = await loadPeopleAcross({ getAll }, ['h1', 'bad', 'h2', 'h1'], { identity: new Map() });
		expect(getAll).toHaveBeenCalledTimes(3);
		expect(out.connectors.map((p) => p.id)).toEqual(['1']);
		expect(out.bridges).toEqual([{ a: 'h1', b: 'h2', people: ['1'] }]);
	});

	it('takes the key directory from the relays when none is given', async () => {
		const getAll = vi.fn(async (holon: string) => (holon === '-100' ? [{ id: 7 }] : [{ id: KEY_A }]));
		const getAllGlobal = vi.fn(async () => [
			{ provider: 'p'.repeat(64), identifier: 'telegram:7', platform: 'telegram', platformId: '7', pubkeys: [KEY_A], createdAt: 1, eventId: 'e1' },
		]);
		const out = await loadPeopleAcross({ getAll, getAllGlobal }, ['-100', 'holon_abcdefghijkl']);
		expect(out.connectors.map((p) => p.id)).toEqual(['7']);
	});
});

describe('loadFederationPeople', () => {
	const rosters: Record<string, unknown> = {
		home: [{ id: 1, first_name: 'Ada' }, { id: KEY_A }],
		p1: [{ id: 1, first_name: 'Ada' }, { id: 2, first_name: 'Bea', last_name: 'Rossi', username: 'bea' }, { id: 9, is_bot: true }],
		p2: { x: { id: 2 }, y: { id: 3, username: 'cleo' }, z: { id: 7 } },
	};
	const getAll = vi.fn(async (holon: string) => rosters[holon] ?? []);

	it("lists the partners' people who are not in the holon, once each", async () => {
		const out = await loadFederationPeople({ getAll } as never, 'home', { partners: ['p1', 'p2', 'home'], identity: new Map([[KEY_A, '7']]) });
		expect(out).toEqual([
			{ id: '2', first_name: 'Bea', last_name: 'Rossi', username: 'bea', name: 'Bea Rossi', holons: ['p1', 'p2'] },
			{ id: '3', username: 'cleo', name: 'cleo', holons: ['p2'] },
		]);
	});

	it("reads the partners from the holon's federation record", async () => {
		const getFederation = vi.fn(async () => ({ federated: ['p2'] }));
		const out = await loadFederationPeople({ getAll, getFederation } as never, 'home', { identity: new Map() });
		expect(getFederation).toHaveBeenCalledWith('home');
		expect(out.map((p) => p.id)).toEqual(['3', '2', '7']);
	});

	it('is empty with no federation, or when it cannot be read', async () => {
		expect(await loadFederationPeople({ getAll, getFederation: async () => null } as never, 'home')).toEqual([]);
		expect(
			await loadFederationPeople({ getAll, getFederation: async () => Promise.reject(new Error('offline')) } as never, 'home'),
		).toEqual([]);
	});
});

describe('findPeople', () => {
	const people = [
		{ id: '11', name: 'Marco Bianchi', first_name: 'Marco', last_name: 'Bianchi' },
		{ id: '12', name: 'Anna Marconi', first_name: 'Anna', last_name: 'Marconi' },
		{ id: '13', name: 'Lucía', first_name: 'Lucía', username: 'lu_cia' },
		{ id: '123456', name: '' },
	];

	it('puts a name starting with the query before one containing it', () => {
		expect(findPeople(people, 'marc').map((p) => p.id)).toEqual(['11', '12']);
		expect(findPeople(people, 'bian').map((p) => p.id)).toEqual(['11']);
	});

	it('ignores case, accents and a leading @', () => {
		expect(findPeople(people, 'LUCIA').map((p) => p.id)).toEqual(['13']);
		expect(findPeople(people, '@lu_c').map((p) => p.id)).toEqual(['13']);
	});

	it('finds by id, and nobody for a blank query', () => {
		expect(findPeople(people, '3456').map((p) => p.id)).toEqual(['123456']);
		expect(findPeople(people, '12').map((p) => p.id)).toEqual(['12']);
		expect(findPeople(people, '23').map((p) => p.id)).toEqual([]);
		expect(findPeople(people, '  ')).toEqual([]);
		expect(findPeople(people, 'a', 1)).toHaveLength(1);
	});
});
