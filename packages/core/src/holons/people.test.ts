// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { loadPeopleAcross, peopleAcross } from './people.js';

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
