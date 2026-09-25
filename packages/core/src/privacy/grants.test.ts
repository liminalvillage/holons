// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { encodeGrant, isLensGrant, parseGrant } from './grants.js';

const base = { t: 'holons/grant', v: 1, id: 'g1', holon: '-100', lens: 'quests', kid: 'a'.repeat(16), at: '2026-09-23T00:00:00.000Z' };

describe('privacy/grants', () => {
  it('round-trips a lens grant and an item grant', () => {
    const lens = parseGrant(encodeGrant({ ...base, key: 'AB'.repeat(32) } as never));
    expect(lens).toEqual({ ...base, key: 'ab'.repeat(32) });
    expect(isLensGrant(lens!)).toBe(true);
    const item = parseGrant({ ...base, item: 'q1', cek: 'cd'.repeat(32) });
    expect(item).toEqual({ ...base, item: 'q1', cek: 'cd'.repeat(32) });
    expect(isLensGrant(item!)).toBe(false);
  });

  it('drops anything malformed', () => {
    expect(parseGrant('nope')).toBeNull();
    expect(parseGrant({ ...base, v: 2, key: 'ab'.repeat(32) })).toBeNull();
    expect(parseGrant({ ...base, kid: 'xyz', key: 'ab'.repeat(32) })).toBeNull();
    expect(parseGrant({ ...base, key: 'ab' })).toBeNull();
    expect(parseGrant({ ...base, item: 'q1', cek: 'zz' })).toBeNull();
    expect(parseGrant({ ...base, item: '', cek: 'ab'.repeat(32) })).toBeNull();
    expect(parseGrant({ ...base })).toBeNull();
    expect(parseGrant({ ...base, holon: '', key: 'ab'.repeat(32) })).toBeNull();
  });

  it('fills a missing timestamp', () => {
    const g = parseGrant({ ...base, at: undefined, key: 'ab'.repeat(32) });
    expect(typeof g?.at).toBe('string');
  });
});
