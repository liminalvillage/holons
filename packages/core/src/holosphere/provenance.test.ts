// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { deleteRef, recordKey, sourceHolonId, sourceRef } from './provenance.js';

const federated = (origin: string, id: string) => ({ id, _federation: { origin } });
const hologram = (sourceHolon: string, id: string, sourceKey?: string) => ({
	id,
	_hologram: { isHologram: true, sourceHolon, sourceKey }
});

describe('sourceHolonId', () => {
	it('is undefined for the holon\'s own record', () => {
		expect(sourceHolonId({ id: 'shopping' })).toBeUndefined();
	});

	it('reads a federated partner origin', () => {
		expect(sourceHolonId(federated('-100294', 'shopping'))).toBe('-100294');
	});

	it('prefers the hologram source holon', () => {
		expect(sourceHolonId(hologram('-100294', 'shopping'))).toBe('-100294');
	});
});

describe('sourceRef', () => {
	it('is undefined for a local record — write it in place', () => {
		expect(sourceRef({ id: 'shopping' }, 'shopping')).toBeUndefined();
	});

	it('targets the partner holon under the shared id', () => {
		expect(sourceRef(federated('-100294', 'shopping'), 'shopping')).toEqual({
			holon: '-100294',
			key: 'shopping'
		});
	});

	it('uses a hologram\'s authoritative source key over the local one', () => {
		expect(sourceRef(hologram('-100294', 'local-alias', 'real-key'), 'local-alias')).toEqual({
			holon: '-100294',
			key: 'real-key'
		});
	});
});

describe('recordKey', () => {
	it('leaves a local record on its bare id', () => {
		expect(recordKey({ id: 'shopping' }, 'shopping')).toBe('shopping');
	});

	it('qualifies a federated record with its origin holon', () => {
		expect(recordKey(federated('-100294', 'shopping'), 'shopping')).toBe('-100294::shopping');
	});

	it('keeps same-named lists from different holons apart', () => {
		const keys = new Set([
			recordKey({ id: 'shopping' }, 'shopping'),
			recordKey(federated('-100294', 'shopping'), 'shopping'),
			recordKey(federated('-500123', 'shopping'), 'shopping')
		]);
		expect(keys.size).toBe(3);
	});

	it('keys a hologram off its source holon, not the local pointer', () => {
		expect(recordKey(hologram('-100294', 'shopping'), 'shopping')).toBe('-100294::shopping');
	});
});

describe('deleteRef', () => {
	it('deletes the holon\'s own record in place', () => {
		expect(deleteRef({ id: 'q1' }, '-100555', 'q1')).toEqual({
			holon: '-100555',
			key: 'q1',
			kind: 'own'
		});
	});

	it('drops the local mirror of a hologram, never the source', () => {
		expect(deleteRef(hologram('-100294', 'local-alias', 'real-key'), '-100555', 'local-alias')).toEqual({
			holon: '-100555',
			key: 'local-alias',
			kind: 'mirror'
		});
	});

	it('routes a federated copy to its owner holon', () => {
		expect(deleteRef(federated('-100294', 'q1'), '-100555', 'q1')).toEqual({
			holon: '-100294',
			key: 'q1',
			kind: 'federated'
		});
	});

	it('disagrees with sourceRef only for holograms', () => {
		const h = hologram('-100294', 'q1', 'q1');
		expect(sourceRef(h, 'q1')?.holon).toBe('-100294');
		expect(deleteRef(h, '-100555', 'q1').holon).toBe('-100555');
		const f = federated('-100294', 'q1');
		expect(deleteRef(f, '-100555', 'q1').holon).toBe(sourceRef(f, 'q1')?.holon);
	});
});
