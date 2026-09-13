import { describe, it, expect } from 'vitest';
import { createTrustCache, parseDuration } from '../src/createHoloSphere.js';

describe('parseDuration', () => {
  it('reads seconds and s/m/h/d suffixes', () => {
    expect(parseDuration('3600')).toBe(3600);
    expect(parseDuration('30m')).toBe(1800);
    expect(parseDuration('12h')).toBe(43200);
    expect(parseDuration('7d')).toBe(604800);
    expect(parseDuration('')).toBeUndefined();
    expect(parseDuration('soon')).toBeUndefined();
    expect(parseDuration('0d')).toBeUndefined();
  });
});

describe('createTrustCache', () => {
  it('publishes NIP-29 group state only when it changes', async () => {
    const { deriveTelegramNostrKey } = await import('@holons/core/auth');
    const users = [{ id: 1, first_name: 'Alice' }];
    const published = [];
    const fake = {
      getAll: async () => users,
      get: async () => ({ id: '-1', name: 'Test holon', admin: '1' }),
      publishNostrEvents: () => {},
    };
    const { setProjectionHostForTests } =
      await import('../src/createHoloSphere.js');
    setProjectionHostForTests(fake);
    const holonPk = 'a'.repeat(64);
    const trust = createTrustCache(holonPk, 'secret', 0, {
      ctx: {
        appName: 'T',
        holonPubkey: holonPk,
        pubkeyFor: id => deriveTelegramNostrKey(id, 'secret').publicKey,
      },
      publish: t => published.push(...t),
    });
    const alice = deriveTelegramNostrKey(1, 'secret').publicKey;
    expect(await trust.trustedAuthors('-1')).toEqual([holonPk, alice]);
    expect(published.map(t => t.kind)).toEqual([39000, 39001, 39002]);
    expect(published[2].tags.filter(t => t[0] === 'p').map(t => t[1])).toEqual([
      alice,
    ]);
    expect(published[1].tags.filter(t => t[0] === 'p')).toEqual([
      ['p', holonPk, 'admin'],
      ['p', alice, 'admin'],
    ]);
    await trust.trustedAuthors('-1');
    expect(published).toHaveLength(3); // unchanged → nothing republished
    users.push({ id: 2, first_name: 'Bob' });
    await trust.trustedAuthors('-1');
    expect(published).toHaveLength(4);
    expect(published[3].kind).toBe(39002);
    expect(trust.userIdFor(deriveTelegramNostrKey(2, 'secret').publicKey)).toBe(
      2
    );
    setProjectionHostForTests(null);
  });

  it('trusts the holon key alone without an instance or secret', async () => {
    const trust = createTrustCache('a'.repeat(64), '');
    expect(await trust.trustedAuthors('-1')).toEqual(['a'.repeat(64)]);
    expect(trust.userIdFor('b'.repeat(64))).toBeUndefined();
  });
});

describe('createTrustCache — linked keys', () => {
  it('trusts a member’s linked keys and resolves them to the member; derived keys outrank, first claim wins', async () => {
    const { deriveTelegramNostrKey } = await import('@holons/core/auth');
    const { setProjectionHostForTests } =
      await import('../src/createHoloSphere.js');
    const LINK_A = 'a'.repeat(64);
    const LINK_B = 'b'.repeat(64);
    const LINK_C = 'c'.repeat(64);
    const bobDerived = deriveTelegramNostrKey(2, 'secret').publicKey;
    const users = [
      // Alice links A on the group record and B on her personal record;
      // she also lists Bob's derived key, which must not be remapped.
      { id: 1, first_name: 'Alice', linkedKeys: [LINK_A, bobDerived] },
      // Bob claims A too (second claim loses) and C.
      { id: 2, first_name: 'Bob', linkedKeys: [LINK_A, LINK_C] },
    ];
    const personal = { 1: { id: 1, linkedKeys: [LINK_B] } };
    setProjectionHostForTests({
      getAll: async () => users,
      get: async (holon, lens, key) =>
        lens === 'users' ? (personal[key] ?? null) : null,
    });
    const holonPk = 'f'.repeat(64);
    const trust = createTrustCache(holonPk, 'secret', 0);
    const aliceDerived = deriveTelegramNostrKey(1, 'secret').publicKey;
    const list = await trust.trustedAuthors('-1');
    expect(new Set(list)).toEqual(
      new Set([holonPk, aliceDerived, bobDerived, LINK_A, LINK_B, LINK_C])
    );
    expect(trust.userIdFor(LINK_A)).toBe(1);
    expect(trust.userIdFor(LINK_B)).toBe(1);
    expect(trust.userIdFor(LINK_C)).toBe(2);
    expect(trust.userIdFor(bobDerived)).toBe(2);
  });
});
