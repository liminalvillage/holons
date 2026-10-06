import { describe, expect, it, vi } from 'vitest';
import { fetchProfiles, mergeProfileContent, parseProfileEvent, profileDisplayName } from './profiles.js';
import type { NostrEventLike } from '../nostr/types.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const ev = (pubkey: string, content: unknown, created_at = 100, kind = 0): NostrEventLike => ({
  id: `${pubkey.slice(0, 4)}-${created_at}`, pubkey, kind, created_at, tags: [],
  content: typeof content === 'string' ? content : JSON.stringify(content),
});

describe('parseProfileEvent', () => {
  it('reads the public fields of a kind 0, cleaned, and keeps the whole content', () => {
    const p = parseProfileEvent(ev(A, { name: ' ada ', display_name: 'Ada\u0000 Lovelace', picture: 'https://x/p.png', about: 'hi', nip05: 'ada@x.io', lud16: 'ada@wallet' }))!;
    expect(p).toMatchObject({ pubkey: A, name: 'ada', display_name: 'Ada Lovelace', picture: 'https://x/p.png', about: 'hi', nip05: 'ada@x.io', createdAt: 100 });
    expect(p.raw.lud16).toBe('ada@wallet');
  });
  it('ignores the wrong kind, bad JSON, non-objects and non-URL pictures', () => {
    expect(parseProfileEvent(ev(A, { name: 'x' }, 1, 1))).toBeNull();
    expect(parseProfileEvent(ev(A, 'nope'))).toBeNull();
    expect(parseProfileEvent(ev(A, [1]))).toBeNull();
    expect(parseProfileEvent(ev(A, { picture: 'javascript:alert(1)' }))!.picture).toBeUndefined();
    expect(parseProfileEvent(null)).toBeNull();
  });
});

describe('profileDisplayName', () => {
  it('prefers display_name, falls back to name, and never shows digits alone', () => {
    expect(profileDisplayName(parseProfileEvent(ev(A, { name: 'ada', display_name: 'Ada L' })))).toBe('Ada L');
    expect(profileDisplayName(parseProfileEvent(ev(A, { name: 'ada' })))).toBe('ada');
    expect(profileDisplayName(parseProfileEvent(ev(A, { name: '235114395' })))).toBe('');
    expect(profileDisplayName(parseProfileEvent(ev(A, { display_name: '42', name: 'ada' })))).toBe('ada');
    expect(profileDisplayName(null)).toBe('');
  });
});

describe('fetchProfiles', () => {
  it('asks once per hundred keys and keeps the newest per key', async () => {
    const keys = Array.from({ length: 250 }, (_, i) => i.toString(16).padStart(64, '0'));
    const queryNostr = vi.fn(async (f: Record<string, unknown>) => {
      const authors = f.authors as string[];
      return authors.flatMap((pk) => [ev(pk, { name: `old-${pk.slice(-2)}` }, 1), ev(pk, { name: `new-${pk.slice(-2)}` }, 2)]);
    });
    const out = await fetchProfiles({ queryNostr }, [...keys, keys[0], 'not-a-key']);
    expect(queryNostr).toHaveBeenCalledTimes(3);
    expect(queryNostr.mock.calls.map((c) => (c[0].authors as string[]).length)).toEqual([100, 100, 50]);
    expect(out.size).toBe(250);
    expect(out.get(keys[7])!.name).toBe(`new-${keys[7].slice(-2)}`);
  });
  it('is empty without a host, without keys, or when the query fails', async () => {
    expect((await fetchProfiles(null, [A])).size).toBe(0);
    expect((await fetchProfiles({ queryNostr: async () => [] }, [])).size).toBe(0);
    expect((await fetchProfiles({ queryNostr: async () => { throw new Error('x'); } }, [A, B])).size).toBe(0);
  });
});

describe('mergeProfileContent', () => {
  it('lays the edit over every field another client set; "" removes, undefined keeps', () => {
    const existing = { name: 'ada', display_name: 'Ada', nip05: 'ada@x.io', lud16: 'ada@wallet', banner: 'https://x/b.png' };
    expect(mergeProfileContent(existing, { display_name: 'Ada Lovelace', about: undefined, banner: '' })).toEqual({
      name: 'ada', display_name: 'Ada Lovelace', nip05: 'ada@x.io', lud16: 'ada@wallet',
    });
    expect(mergeProfileContent(null, { name: 'x' })).toEqual({ name: 'x' });
  });
});
