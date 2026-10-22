import { describe, expect, it, vi } from 'vitest';
import * as nip19 from 'nostr-tools/nip19';
import { createNameResolver } from './resolver.js';
import { shortId } from './ids.js';
import type { NostrEventLike } from '../nostr/types.js';

const KEY_A = '1a'.repeat(32); // a person with a kind 0
const KEY_B = '2b'.repeat(32); // linked to Telegram 42 by attestation
const KEY_C = '3c'.repeat(32); // attested name only
const KEY_D = '4d'.repeat(32); // a key-founded holon
const KEY_E = '5e'.repeat(32); // nothing names it
const KEY_J = '6f'.repeat(32); // a pending join request
const PROVIDER = 'ee'.repeat(32);
const HOLON = 'holon_test';

const kind0 = (pubkey: string, content: Record<string, unknown>, created_at = 10): NostrEventLike => ({
  id: `${pubkey.slice(0, 6)}-${created_at}`, pubkey, kind: 0, created_at, tags: [], content: JSON.stringify(content),
});

/** A fake holosphere: lenses as nested maps, a kind-0 relay, a spy on every query. */
function host(overrides: Partial<{ users: Record<string, unknown[]>; settings: Record<string, unknown>; directory: unknown[]; relay: NostrEventLike[] }> = {}) {
  const users: Record<string, unknown[]> = overrides.users ?? {
    [HOLON]: [{ id: 42, first_name: 'Ada', last_name: 'Lovelace', username: '42' }, { id: 7, username: 'grace' }, { id: KEY_B, first_name: 'Bea' }],
    '99': [{ id: 99, first_name: 'Personal', last_name: 'Holon' }],
  };
  const settings: Record<string, unknown> = overrides.settings ?? {
    [KEY_D]: { id: KEY_D, name: 'Orto Collettivo' },
    '-1001': [{ id: '-1001', name: 'Liminal' }],
    'holon_my': { id: 'holon_my', name: 'My Holon' },
    'holon_titled': { id: 'holon_titled', title: 'Titled' },
  };
  const directory = overrides.directory ?? [
    { id: 'x1', provider: PROVIDER, identifier: 'telegram:42', platform: 'telegram', platformId: '42', pubkeys: [KEY_B], name: 'Ada L', createdAt: 5, eventId: 'e1' },
    { id: 'x2', provider: PROVIDER, identifier: 'telegram:555', platform: 'telegram', platformId: '555', pubkeys: [KEY_C], name: 'Carla', createdAt: 6, eventId: 'e2' },
  ];
  const relay = overrides.relay ?? [kind0(KEY_A, { name: 'alan', display_name: 'Alan Turing', picture: 'https://x/alan.png' }), kind0(KEY_E, { name: '12345' })];
  const queryNostr = vi.fn(async (f: Record<string, unknown>) => relay.filter((e) => (f.authors as string[]).includes(e.pubkey)));
  const get = vi.fn(async (h: string, lens: string, key: string) => {
    if (lens === 'settings') return settings[h] ?? null;
    if (lens === 'users') return (users[h] ?? []).find((u) => String((u as { id: unknown }).id) === key) ?? null;
    return null;
  });
  const getAll = vi.fn(async (h: string, lens: string) => (lens === 'users' ? users[h] ?? [] : []));
  const getAllGlobal = vi.fn(async (lens: string) => (lens === 'shift_identity' ? directory : []));
  return { get, getAll, getAllGlobal, queryNostr, store: { wire: { isStandardPrimary: () => true } } };
}

describe('createNameResolver', () => {
  it('names a Telegram id from the holon users, formatted per the surface; digits-only handles are not names', async () => {
    const r = createNameResolver(host(), { holon: HOLON, format: { lastName: 'initial' } });
    const out = await r.resolve([42, '7', 99, 123]);
    expect(out.get('42')).toBe('Ada L.');
    expect(out.get('7')).toBe('grace');
    expect(out.get('99')).toBe('Personal H.'); // personal-holon record
    expect(out.get('123')).toBe('#123'); // nobody knows: the short form
  });

  it('names a key through the 31926 directory: the Telegram person behind it, else the attested name', async () => {
    const h = host();
    const r = createNameResolver(h, { holon: HOLON });
    const out = await r.resolve([KEY_B, KEY_C, nip19.npubEncode(KEY_C)]);
    expect(out.get(KEY_B)).toBe('Bea'); // the holon's own record for that key wins
    expect(out.get(KEY_C)).toBe('Carla');
    expect(out.get(nip19.npubEncode(KEY_C))).toBe('Carla'); // an npub is the same key
    expect(h.queryNostr).not.toHaveBeenCalled(); // nothing left for the relays
  });

  it('names a key from its kind 0, keeps the profile for avatars, and never shows digits alone', async () => {
    const h = host();
    const r = createNameResolver(h, { holon: HOLON });
    const out = await r.resolve([KEY_A, KEY_E]);
    expect(out.get(KEY_A)).toBe('Alan Turing');
    expect(r.profileOf(KEY_A)?.picture).toBe('https://x/alan.png');
    expect(out.get(KEY_E)).toBe(shortId(KEY_E));
    expect(h.queryNostr).toHaveBeenCalledTimes(1);
    expect((h.queryNostr.mock.calls[0][0].authors as string[]).sort()).toEqual([KEY_A, KEY_E].sort());
  });

  it('names holons from settings (name or title, never "My Holon") then HNS; a key holon is tried as a person first', async () => {
    const hns = vi.fn(async (id: string) => (id === 'holon_hns' ? 'From HNS' : null));
    const r = createNameResolver(host(), { holon: HOLON, hns });
    const out = await r.resolve(['-1001', 'holon_titled', 'holon_my', 'holon_hns', KEY_D, 'holon_none']);
    expect(out.get('-1001')).toBe('Liminal');
    expect(out.get('holon_titled')).toBe('Titled');
    expect(out.get('holon_my')).toBe('holon_my'); // the default is no name
    expect(out.get('holon_hns')).toBe('From HNS');
    expect(out.get(KEY_D)).toBe('Orto Collettivo');
    expect(out.get('holon_none')).toBe('holon_none');
  });

  it('names a key from the join request it sent, when the surface watches them', async () => {
    const joinRequests = vi.fn(async () => [{ pubkey: KEY_J, reason: 'Jo Join' }, { pubkey: KEY_E, reason: shortId(KEY_E) }]);
    const r = createNameResolver(host(), { holon: HOLON, joinRequests });
    const out = await r.resolve([KEY_J, KEY_E]);
    expect(out.get(KEY_J)).toBe('Jo Join');
    expect(out.get(KEY_E)).toBe(shortId(KEY_E)); // a placeholder reason is no name
  });

  it('nameOf answers the short form at once, learns in the background, and tells subscribers once per batch', async () => {
    const r = createNameResolver(host(), { holon: HOLON });
    const seen: Array<ReadonlyMap<string, string>> = [];
    r.subscribe((m) => seen.push(m));
    expect(r.nameOf(42)).toBe('#42');
    expect(r.nameOf(KEY_A)).toBe(shortId(KEY_A));
    await new Promise((res) => setTimeout(res, 20));
    expect(r.nameOf(42)).toBe('Ada Lovelace');
    expect(r.nameOf(KEY_A)).toBe('Alan Turing');
    expect(seen).toHaveLength(1);
    expect(seen[0].get('42')).toBe('Ada Lovelace');
  });

  it('the signed-in person is named from `self` before any source', async () => {
    const r = createNameResolver(host(), { holon: HOLON, self: () => ({ id: KEY_E, first_name: 'Me', last_name: 'Myself' }) });
    expect(r.nameOf(KEY_E)).toBe('Me Myself');
    expect((await r.resolve(KEY_E)).get(KEY_E)).toBe('Me Myself');
  });

  it('dedupes concurrent lookups, caches hits for the TTL and misses briefly, and forgets on invalidate', async () => {
    let t = 1_000_000;
    const h = host();
    const r = createNameResolver(h, { holon: HOLON, now: () => t, ttlMs: 1000, missTtlMs: 100 });
    await Promise.all([r.resolve([KEY_A, KEY_E]), r.resolve([KEY_A]), r.resolve(KEY_E)]);
    expect(h.queryNostr).toHaveBeenCalledTimes(1);
    await r.resolve([KEY_A, KEY_E]);
    expect(h.queryNostr).toHaveBeenCalledTimes(1); // hit cached, miss cached
    t += 150;
    await r.resolve([KEY_E]);
    expect(h.queryNostr).toHaveBeenCalledTimes(2); // the miss is asked again
    t += 1000;
    await r.resolve([KEY_A]);
    expect(h.queryNostr).toHaveBeenCalledTimes(3); // the hit expired
    r.invalidate(KEY_A);
    await r.resolve([KEY_A]);
    expect(h.queryNostr).toHaveBeenCalledTimes(4);
  });

  it('prime takes names the surface holds, ignoring placeholders and the defaults that are not names', async () => {
    const r = createNameResolver(host(), { holon: HOLON });
    r.prime([['-2002', 'Casa Selva'], [KEY_E, shortId(KEY_E)], ['holon_x', 'My Holon'], ['holon_y', '  ']]);
    expect(r.nameOf('-2002')).toBe('Casa Selva');
    expect(r.snapshot().has(KEY_E)).toBe(false);
    expect(r.snapshot().has('holon_x')).toBe(false);
  });

  it('cleans untrusted text from the relays', async () => {
    const h = host({ relay: [kind0(KEY_A, { display_name: 'Mal\u0000ory​ ' + 'x'.repeat(200) })] });
    const r = createNameResolver(h, { holon: HOLON });
    const name = (await r.resolve(KEY_A)).get(KEY_A)!;
    expect(name.startsWith('Malory x')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(64);
  });

  it('setHolon re-reads the new holon users; an id with no record in either is short', async () => {
    const h = host({ users: { a: [{ id: 1, first_name: 'In A' }], b: [{ id: 2, first_name: 'In B' }] }, settings: {}, relay: [] });
    const r = createNameResolver(h, { holon: 'a' });
    expect((await r.resolve(1)).get('1')).toBe('In A');
    expect((await r.resolve(2)).get('2')).toBe('#2');
    r.setHolon('b');
    r.invalidate(2);
    expect((await r.resolve(2)).get('2')).toBe('In B');
  });
});
