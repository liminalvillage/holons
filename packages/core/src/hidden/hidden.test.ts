// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import {
	HIDDEN_LENS,
	buildHiddenEntry,
	hiddenId,
	hiddenIdSet,
	isRefHidden
} from './operations.js';
import { getHiddenEntries, getHiddenIdSet, hideRef, unhideRef } from './persistence.js';
import type { HiddenDB } from './types.js';

const REF = { holon: '-1003864542239', lens: 'quests', key: '1306' };

describe('hiddenId', () => {
	it('joins with colons so the id is soul-path safe', () => {
		expect(hiddenId(REF)).toBe('-1003864542239:quests:1306');
		expect(hiddenId(REF)).not.toContain('/');
	});
});

describe('buildHiddenEntry', () => {
	it('carries the ref, canonical id and timestamp', () => {
		const e = buildHiddenEntry(REF, { by: 235114395, now: '2026-08-18T00:00:00.000Z' });
		expect(e).toEqual({
			id: '-1003864542239:quests:1306',
			holon: '-1003864542239',
			lens: 'quests',
			key: '1306',
			created: '2026-08-18T00:00:00.000Z',
			by: 235114395
		});
	});

	it('defaults created to now and omits an absent actor', () => {
		const e = buildHiddenEntry(REF);
		expect(Date.parse(e.created)).not.toBeNaN();
		expect('by' in e).toBe(false);
	});
});

describe('hiddenIdSet', () => {
	it('collects ids, skipping nulls, tombstones and malformed records', () => {
		const set = hiddenIdSet([
			buildHiddenEntry(REF),
			null,
			{ id: 'a:quests:1', _deleted: true },
			{ noId: true },
			{ id: 42 }
		]);
		expect(set).toEqual(new Set([hiddenId(REF)]));
	});

	it('returns an empty set for a non-array read', () => {
		expect(hiddenIdSet(undefined)).toEqual(new Set());
		expect(hiddenIdSet('junk')).toEqual(new Set());
	});
});

describe('isRefHidden', () => {
	const set = new Set([hiddenId(REF)]);

	it('matches a hidden ref and misses others', () => {
		expect(isRefHidden(set, REF)).toBe(true);
		expect(isRefHidden(set, { ...REF, key: '999' })).toBe(false);
	});

	it('never hides own records (no ref)', () => {
		expect(isRefHidden(set, undefined)).toBe(false);
	});
});

/** In-memory HiddenDB double — keyed like Holosphere (holon → lens → id). */
function fakeDb(): HiddenDB & { rows: Map<string, Map<string, unknown>> } {
	const rows = new Map<string, Map<string, unknown>>();
	const bucket = (holon: string, lens: string) => {
		const k = `${holon}|${lens}`;
		if (!rows.has(k)) rows.set(k, new Map());
		return rows.get(k)!;
	};
	return {
		rows,
		getAll: async (holon, lens) => [...bucket(holon, lens).values()],
		put: async (holon, lens, value) => {
			bucket(holon, lens).set(String((value as { id: string }).id), value);
		},
		delete: async (holon, lens, key) => {
			bucket(holon, lens).delete(key);
		}
	};
}

describe('persistence', () => {
	it('hideRef stores under the hidden lens, keyed by canonical id', async () => {
		const db = fakeDb();
		const entry = await hideRef(db, 235114395, REF, { by: 235114395 });
		expect(entry.id).toBe(hiddenId(REF));
		expect(db.rows.get(`235114395|${HIDDEN_LENS}`)?.get(entry.id)).toBe(entry);
	});

	it('round-trips through getHiddenEntries / getHiddenIdSet and unhideRef', async () => {
		const db = fakeDb();
		await hideRef(db, '235114395', REF);
		await hideRef(db, '235114395', { ...REF, key: '363' });

		expect((await getHiddenEntries(db, '235114395')).map((e) => e.key).sort()).toEqual([
			'1306',
			'363'
		]);
		expect(await getHiddenIdSet(db, '235114395')).toEqual(
			new Set([hiddenId(REF), hiddenId({ ...REF, key: '363' })])
		);

		await unhideRef(db, '235114395', REF);
		const left = await getHiddenIdSet(db, '235114395');
		expect(left.has(hiddenId(REF))).toBe(false);
		expect(left.has(hiddenId({ ...REF, key: '363' }))).toBe(true);
	});

	it('getHiddenEntries drops tombstoned and malformed rows', async () => {
		const db = fakeDb();
		await hideRef(db, '1', REF);
		db.rows.get(`1|${HIDDEN_LENS}`)!.set('dead', { id: 'dead', _deleted: true });
		db.rows.get(`1|${HIDDEN_LENS}`)!.set('junk', { noId: true });
		expect((await getHiddenEntries(db, '1')).map((e) => e.id)).toEqual([hiddenId(REF)]);
	});
});
