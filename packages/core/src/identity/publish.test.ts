import { describe, expect, it, vi } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { verifyEvent } from 'nostr-tools/pure';
import { signerFromSecretKey } from '../holosphere/signers.js';
import { testKey } from '../protocol/testing.js';
import type { NostrEventLike } from '../nostr/types.js';
import { publishProfile } from './publish.js';
import { shortId } from './ids.js';

const me = testKey();
const signer = signerFromSecretKey(bytesToHex(me.sk));

function host(existing: Record<string, unknown> | null, record: Record<string, unknown> | null = null) {
  const published: NostrEventLike[] = [];
  const puts: Array<[string, string, Record<string, unknown>]> = [];
  return {
    published,
    puts,
    queryNostr: vi.fn(async () => (existing ? [{ id: 'e', pubkey: me.pk, kind: 0, created_at: 5, tags: [], content: JSON.stringify(existing) }] : [])),
    publishNostrEvents: (e: unknown) => published.push(...((Array.isArray(e) ? e : [e]) as NostrEventLike[])),
    get: vi.fn(async () => record),
    put: vi.fn(async (h: string, l: string, d: Record<string, unknown>) => void puts.push([h, l, d])),
  };
}

describe('publishProfile', () => {
  it('lays the edit over the kind 0 the relays hold, signed by the person, and mirrors the record', async () => {
    const h = host({ name: 'ada', display_name: 'Ada', nip05: 'ada@x.io', lud16: 'ada@wallet', banner: 'https://x/b.png' }, { id: me.pk, first_name: 'Ada', last_name: 'L' });
    const ev = (await publishProfile(h, signer, { first_name: 'Ada', last_name: 'Lovelace', about: 'maths' }, { holon: 'holon_x', now: () => 1_800_000_000 }))!;
    expect(verifyEvent(ev as never)).toBe(true);
    expect(ev.pubkey).toBe(me.pk);
    expect(ev.kind).toBe(0);
    expect(JSON.parse(ev.content)).toEqual({
      name: 'ada', display_name: 'Ada Lovelace', about: 'maths', nip05: 'ada@x.io', lud16: 'ada@wallet', banner: 'https://x/b.png',
    });
    expect(h.published).toEqual([ev]);
    expect(h.puts).toEqual([['holon_x', 'users', { id: me.pk, first_name: 'Ada', last_name: 'Lovelace', about: 'maths' }]]);
  });

  it('starts a profile from nothing, drops placeholders, and publishes nothing for an empty edit', async () => {
    const h = host(null);
    const ev = (await publishProfile(h, signer, { first_name: 'Grace', picture: 'https://x/g.png' }))!;
    expect(JSON.parse(ev.content)).toEqual({ name: 'Grace', display_name: 'Grace', picture: 'https://x/g.png' });
    expect(h.puts).toEqual([]); // no holon named
    expect(await publishProfile(h, signer, { first_name: shortId(me.pk) })).toBeNull();
    expect(await publishProfile(h, signer, {})).toBeNull();
  });

  it('an empty field removes it from the profile without touching the rest', async () => {
    const h = host({ name: 'ada', display_name: 'Ada', about: 'old', nip05: 'ada@x.io' }, { id: me.pk, first_name: 'Ada', about: 'old' });
    const ev = (await publishProfile(h, signer, { about: '' }, { holon: 'holon_x' }))!;
    expect(JSON.parse(ev.content)).toEqual({ name: 'ada', display_name: 'Ada', nip05: 'ada@x.io' });
    expect(h.puts[0][2]).toEqual({ id: me.pk, first_name: 'Ada' });
  });
});
