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
