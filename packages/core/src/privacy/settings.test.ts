// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { assertPrivatizable, isPubkeyHolonId, lensPrivacy, readPrivacy, withLensPrivacy } from './settings.js';

describe('privacy/settings', () => {
  it('reads only well-formed hints', () => {
    expect(readPrivacy(null)).toEqual({ lenses: {} });
    expect(readPrivacy({ privacy: { lenses: { quests: 'private', roles: 'public', junk: 'maybe' } } })).toEqual({
      lenses: { quests: 'private', roles: 'public' },
    });
    expect(lensPrivacy({ privacy: { lenses: { quests: 'private' } } }, 'quests')).toBe('private');
    expect(lensPrivacy({}, 'quests')).toBe('public');
  });

  it('withLensPrivacy returns a new record; public removes the entry', () => {
    const s = { id: 'h', name: 'x', privacy: { lenses: { roles: 'private' as const } } };
    const p = withLensPrivacy(s, 'quests', 'private');
    expect(p.privacy.lenses).toEqual({ roles: 'private', quests: 'private' });
    expect(p).not.toBe(s);
    expect(s.privacy.lenses).toEqual({ roles: 'private' });
    expect(withLensPrivacy(p, 'roles', 'public').privacy.lenses).toEqual({ quests: 'private' });
  });

  it('refuses lenses that can never be private', () => {
    expect(() => assertPrivatizable('settings')).toThrow(/cannot be private/);
    expect(() => assertPrivatizable('_vault')).toThrow(/cannot be private/);
    expect(() => assertPrivatizable('')).toThrow(/lens name/);
    expect(() => assertPrivatizable('claims', { isAppend: () => true })).toThrow(/append-only/);
    expect(() => assertPrivatizable('shifts', { isStandardPrimary: (l) => l === 'shifts' })).toThrow(/standard Nostr kind/);
    expect(() => assertPrivatizable('quests', { isAppend: () => false })).not.toThrow();
  });

  it('recognises a personal holon id (a pubkey)', () => {
    expect(isPubkeyHolonId('ab'.repeat(32))).toBe(true);
    expect(isPubkeyHolonId('-1001234')).toBe(false);
    expect(isPubkeyHolonId(null)).toBe(false);
  });
});
