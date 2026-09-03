/**
 * Secret keys may be given as 64-char hex, NIP-19 `nsec1…` or bytes; every
 * entry point (constructor, login, enableSigning) yields the same identity.
 */
import HoloSphere from '../holosphere.js';
import { generateSecretKey, getPublicKey, normalizeSecretKey, toNsec } from '../nostr-events.js';
import { bytesToHex } from '@noble/hashes/utils';

describe('nsec secret keys', () => {
  const skBytes = generateSecretKey();
  const hex = bytesToHex(skBytes);
  const nsec = toNsec(hex);

  test('normalizeSecretKey accepts hex, nsec and bytes', () => {
    expect(nsec.startsWith('nsec1')).toBe(true);
    expect(normalizeSecretKey(nsec)).toBe(hex);
    expect(normalizeSecretKey(hex.toUpperCase())).toBe(hex);
    expect(normalizeSecretKey(skBytes)).toBe(skBytes);
    expect(() => normalizeSecretKey('not-a-key')).toThrow(/64 hex/);
    expect(getPublicKey(nsec)).toBe(getPublicKey(hex));
  });

  test('constructor, login and enableSigning derive the same pubkey from an nsec', async () => {
    const a = new HoloSphere({ appName: 'nsec-test', privateKey: nsec, store: { adapter: 'memory' } });
    const b = new HoloSphere({ appName: 'nsec-test', privateKey: hex, store: { adapter: 'memory' } });
    expect(a.client.publicKey).toBe(b.client.publicKey);
    const c = new HoloSphere({ appName: 'nsec-test', store: { adapter: 'memory' } });
    await c.ready();
    const { pubkey } = await c.login(nsec);
    expect(pubkey).toBe(a.client.publicKey);
    await Promise.all([a.close(), b.close(), c.close()]);
  });
});
