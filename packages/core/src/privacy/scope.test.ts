// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { assertPrivatizable, audienceTag, holonOfTag, holonsOf, isPubkeyHolonId, normScope } from './scope.js';

const PK = 'ab'.repeat(32);

describe('scope helpers', () => {
  it('normScope trims and drops an empty item; refuses a missing holon or lens', () => {
    expect(normScope({ holon: ' -1 ', lens: ' quests ' })).toEqual({ holon: '-1', lens: 'quests' });
    expect(normScope({ holon: '-1', lens: 'quests', item: ' q1 ' })).toEqual({ holon: '-1', lens: 'quests', item: 'q1' });
    expect(normScope({ holon: '-1', lens: 'quests', item: '' })).toEqual({ holon: '-1', lens: 'quests' });
    expect(() => normScope({ holon: '', lens: 'quests' })).toThrow(/holon and a lens/);
    expect(() => normScope(null)).toThrow(/holon and a lens/);
  });

  it('an audience entry is a NIP-51 tag: p for a personal holon, group otherwise', () => {
    expect(audienceTag(PK.toUpperCase())).toEqual(['p', PK]);
    expect(audienceTag('-1001')).toEqual(['group', '-1001']);
    expect(audienceTag('holon_abcdefghijkl')).toEqual(['group', 'holon_abcdefghijkl']);
    expect(() => audienceTag('')).toThrow(/holon id/);
  });

  it('holonOfTag reads both kinds and ignores anything else', () => {
    expect(holonOfTag(['p', PK])).toBe(PK);
    expect(holonOfTag(['group', '-1'])).toBe('-1');
    expect(holonOfTag(['p', 'not-a-key'])).toBeNull();
    expect(holonOfTag(['e', 'x'])).toBeNull();
    expect(holonOfTag('p')).toBeNull();
    expect(holonsOf([['group', '-1'], ['p', PK], ['group', '-1'], ['t', 'x']])).toEqual(['-1', PK]);
    expect(holonsOf(null)).toEqual([]);
  });

  it('isPubkeyHolonId', () => {
    expect(isPubkeyHolonId(PK)).toBe(true);
    expect(isPubkeyHolonId('-1001')).toBe(false);
    expect(isPubkeyHolonId(null)).toBe(false);
  });

  it('assertPrivatizable names the reason', () => {
    expect(() => assertPrivatizable('settings')).toThrow(/cannot be private/);
    expect(() => assertPrivatizable('')).toThrow(/lens name/);
    expect(() => assertPrivatizable('claims', { isAppend: () => true })).toThrow(/append-only/);
    expect(() => assertPrivatizable('events', { isStandardPrimary: () => true })).toThrow(/standard Nostr kind/);
    expect(() => assertPrivatizable('quests')).not.toThrow();
  });
});
