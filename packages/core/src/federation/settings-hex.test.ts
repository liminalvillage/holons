// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { readSettingsHex } from './settings-hex.js';
import type { HoloSphere } from 'holosphere';

function mockHolosphere(hex: unknown, opts: { hasIsValidH3?: boolean; throws?: boolean } = {}) {
	const holosphere: any = {
		get: vi.fn(async () => {
			if (opts.throws) throw new Error('relay unreachable');
			return { hex };
		})
	};
	if (opts.hasIsValidH3 !== false) {
		holosphere.isValidH3 = (id: string) => /^8[0-9a-f]{14}$/.test(id);
	}
	return holosphere as HoloSphere;
}

describe('readSettingsHex', () => {
	it('returns a valid H3 cell', async () => {
		expect(await readSettingsHex(mockHolosphere('8928308280fffff'), 'h1')).toBe('8928308280fffff');
	});

	it('returns null for the legacy CSS-color default', async () => {
		expect(await readSettingsHex(mockHolosphere('#3b82f6'), 'h1')).toBeNull();
	});

	it('returns null for empty, missing, or non-string hex', async () => {
		expect(await readSettingsHex(mockHolosphere(''), 'h1')).toBeNull();
		expect(await readSettingsHex(mockHolosphere(undefined), 'h1')).toBeNull();
		expect(await readSettingsHex(mockHolosphere(42), 'h1')).toBeNull();
	});

	it('returns null when settings are unreachable', async () => {
		expect(await readSettingsHex(mockHolosphere('8928308280fffff', { throws: true }), 'h1')).toBeNull();
	});
});
