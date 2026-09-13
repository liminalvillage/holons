// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, it, expect } from 'vitest';
import * as nip19 from 'nostr-tools/nip19';
import {
  normalizePubkey,
  linkedKeysOf,
  getLinkedKeys,
  linkUserKey,
  unlinkUserKey,
  buildKeyLinkChallenge,
  keyLinkProofFilter,
  verifyKeyLinkProof,
  createLinkedKeysResolver,
  KEY_LINK_CODE_PREFIX,
  type TelegramUserLike,
  type UserDB,
  type UserProfile,
} from './index.js';

function makeFakeDB(): UserDB & { _store: Map<string, Map<string, unknown>> } {
  const store = new Map<string, Map<string, unknown>>();
  const keyFor = (holon: string, lens: string) => `${holon}::${lens}`;
  return {
    _store: store,
    async get(holon, lens, key) {
      return store.get(keyFor(holon, lens))?.get(String(key)) ?? null;
    },
    async put(holon, lens, data: any) {
      const k = keyFor(holon, lens);
      if (!store.has(k)) store.set(k, new Map());
      store.get(k)!.set(String(data.id), data);
      return { ok: true };
    },
    async delete(holon, lens, key) {
      return store.get(keyFor(holon, lens))?.delete(String(key)) ?? false;
    },
    async getAll(holon, lens) {
      return Array.from(store.get(keyFor(holon, lens))?.values() ?? []);
    },
  };
}

const ALICE: TelegramUserLike = { id: 42, username: 'alice', first_name: 'Alice' };
const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);
const NPUB_A = nip19.npubEncode(PK_A);

describe('normalizePubkey', () => {
  it('accepts hex (any case), npub, nostr: prefix and whitespace', () => {
    expect(normalizePubkey(PK_A)).toBe(PK_A);
    expect(normalizePubkey(PK_A.toUpperCase())).toBe(PK_A);
    expect(normalizePubkey(NPUB_A)).toBe(PK_A);
    expect(normalizePubkey(`  nostr:${NPUB_A} `)).toBe(PK_A);
  });
  it('rejects junk, short hex, nsec and empty input', () => {
    expect(normalizePubkey('hello')).toBeNull();
    expect(normalizePubkey('abc')).toBeNull();
    expect(normalizePubkey(nip19.nsecEncode(new Uint8Array(32).fill(7)))).toBeNull();
    expect(normalizePubkey('')).toBeNull();
    expect(normalizePubkey(undefined)).toBeNull();
  });
});

describe('linkedKeysOf', () => {
  it('normalises, dedupes and sorts; tolerates a missing or junk list', () => {
    expect(linkedKeysOf(null)).toEqual([]);
    expect(linkedKeysOf({ linkedKeys: undefined })).toEqual([]);
    expect(linkedKeysOf({ linkedKeys: [PK_B, NPUB_A, PK_A.toUpperCase(), 'junk'] })).toEqual([PK_A, PK_B]);
  });
});

describe('linkUserKey / unlinkUserKey', () => {
  it('writes the personal holon record and mirrors onto the named holons', async () => {
    const db = makeFakeDB();
    const keys = await linkUserKey(db, ALICE, NPUB_A, { holons: ['-100', -200] });
    expect(keys).toEqual([PK_A]);
    for (const holon of ['42', '-100', '-200']) {
      const rec = (await db.get(holon, 'users', '42')) as UserProfile;
      expect(rec.linkedKeys).toEqual([PK_A]);
      expect(rec.username).toBe('alice');
    }
    expect(await getLinkedKeys(db, ALICE)).toEqual([PK_A]);
  });

  it('is idempotent and keeps the list sorted', async () => {
    const db = makeFakeDB();
    await linkUserKey(db, ALICE, PK_B);
    await linkUserKey(db, ALICE, PK_A);
    expect(await linkUserKey(db, ALICE, PK_A)).toEqual([PK_A, PK_B]);
  });

  it('unlinks, drops the field when empty, and ignores unknown or junk keys', async () => {
    const db = makeFakeDB();
    await linkUserKey(db, ALICE, PK_A, { holons: ['-100'] });
    expect(await unlinkUserKey(db, ALICE, PK_B)).toEqual([PK_A]);
    expect(await unlinkUserKey(db, ALICE, 'junk')).toEqual([PK_A]);
    expect(await unlinkUserKey(db, ALICE, NPUB_A, { holons: ['-100'] })).toEqual([]);
    const personal = (await db.get('42', 'users', '42')) as UserProfile;
    const group = (await db.get('-100', 'users', '42')) as UserProfile;
    expect('linkedKeys' in personal).toBe(false);
    expect('linkedKeys' in group).toBe(false);
  });

  it('rejects an unparsable key on link', async () => {
    await expect(linkUserKey(makeFakeDB(), ALICE, 'nope')).rejects.toThrow(/hex pubkey or an npub/);
  });
});

describe('key-link challenge + proof', () => {
  const NOW = 1_800_000_000;

  it('issues a readable prefixed code bound to the normalised key', () => {
    const c = buildKeyLinkChallenge(42, NPUB_A, { now: NOW, random: () => 0.5 });
    expect(c).toMatchObject({ telegramId: '42', pubkey: PK_A, issuedAt: NOW });
    expect(c.code.startsWith(KEY_LINK_CODE_PREFIX)).toBe(true);
    expect(c.code.length).toBe(KEY_LINK_CODE_PREFIX.length + 8);
    expect(() => buildKeyLinkChallenge(42, 'junk')).toThrow();
    expect(keyLinkProofFilter(c)).toEqual({ authors: [PK_A], since: NOW, limit: 50 });
  });

  it('accepts a fresh note by the claimed key carrying the code', () => {
    const c = buildKeyLinkChallenge(42, PK_A, { now: NOW });
    const ok = [{ pubkey: PK_A, created_at: NOW + 30, content: `linking my holons: ${c.code} 🙂` }];
    expect(verifyKeyLinkProof(ok, c, { now: NOW + 60 })).toBe(true);
  });

  it('rejects the wrong author, a stale note, a missing code, or an expired challenge', () => {
    const c = buildKeyLinkChallenge(42, PK_A, { now: NOW });
    const note = (over: Partial<{ pubkey: string; created_at: number; content: string }>) => [
      { pubkey: PK_A, created_at: NOW + 30, content: c.code, ...over },
    ];
    expect(verifyKeyLinkProof(note({ pubkey: PK_B }), c, { now: NOW + 60 })).toBe(false);
    expect(verifyKeyLinkProof(note({ created_at: NOW - 1 }), c, { now: NOW + 60 })).toBe(false);
    expect(verifyKeyLinkProof(note({ content: 'no code here' }), c, { now: NOW + 60 })).toBe(false);
    expect(verifyKeyLinkProof(note({}), c, { now: NOW + 16 * 60 })).toBe(false);
    expect(verifyKeyLinkProof([], c, { now: NOW + 60 })).toBe(false);
  });
});

describe('createLinkedKeysResolver', () => {
  it('answers undefined first, then from the personal-holon record; invalidate re-reads', async () => {
    const db = makeFakeDB();
    await linkUserKey(db, ALICE, PK_A);
    let t = 1000;
    const resolver = createLinkedKeysResolver(db, { ttlMs: 500, now: () => t });
    expect(resolver.linkedKeysFor(42)).toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(resolver.linkedKeysFor('42')).toEqual([PK_A]);
    // A change lands; the cached answer stands until invalidated or expired.
    await linkUserKey(db, ALICE, PK_B);
    expect(resolver.linkedKeysFor(42)).toEqual([PK_A]);
    resolver.invalidate(42);
    expect(resolver.linkedKeysFor(42)).toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(resolver.linkedKeysFor(42)).toEqual([PK_A, PK_B]);
    // Past the TTL the stale answer is still served while a re-read warms.
    await unlinkUserKey(db, ALICE, PK_A);
    t += 1000;
    expect(resolver.linkedKeysFor(42)).toEqual([PK_A, PK_B]);
    await new Promise((r) => setTimeout(r, 0));
    expect(resolver.linkedKeysFor(42)).toEqual([PK_B]);
    // Unknown members resolve to an empty list, not undefined forever.
    expect(resolver.linkedKeysFor(7)).toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(resolver.linkedKeysFor(7)).toEqual([]);
  });
});
