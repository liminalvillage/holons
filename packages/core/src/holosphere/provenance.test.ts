// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { recordKey, sourceHolonId, sourceRef } from './provenance.js';

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
