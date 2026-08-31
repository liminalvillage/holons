// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils';
import {
  deriveIdentityProviderKey,
  deriveNostrKeyFromEntropy,
  deriveTelegramNostrKey,
  entropyFromBytes,
  IDENTITY_PROVIDER_CONTEXT,
  ETH_IDENTITY_MESSAGE,
  PASSKEY_PRF_SALT,
  buildAuthEventTemplate,
  signAuthEvent,
  verifyAuthEvent,
  holonIdForIdentity,
  NIP98_KIND,
} from './index.js';

const entropy = new Uint8Array(32).map((_, i) => i * 7 + 1);

describe('deriveNostrKeyFromEntropy', () => {
  it('is deterministic for the same entropy + context', () => {
    const a = deriveNostrKeyFromEntropy(entropy, 'passkey');
    const b = deriveNostrKeyFromEntropy(new Uint8Array(entropy), 'passkey');
    expect(a).toEqual(b);
    expect(a.privateKey).toMatch(/^[0-9a-f]{64}$/);
    expect(a.publicKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('yields a pubkey nostr-tools agrees with', () => {
    const k = deriveNostrKeyFromEntropy(entropy, 'eth:0xabc');
    expect(getPublicKey(Uint8Array.from(Buffer.from(k.privateKey, 'hex')))).toBe(k.publicKey);
  });

  it('separates contexts and entropy', () => {
    const base = deriveNostrKeyFromEntropy(entropy, 'passkey');
    expect(deriveNostrKeyFromEntropy(entropy, 'eth:0xabc').publicKey).not.toBe(base.publicKey);
    const other = new Uint8Array(entropy);
    other[0] ^= 1;
    expect(deriveNostrKeyFromEntropy(other, 'passkey').publicKey).not.toBe(base.publicKey);
  });

  it('rejects short entropy or a missing context', () => {
    expect(() => deriveNostrKeyFromEntropy(new Uint8Array(8), 'x')).toThrow();
    expect(() => deriveNostrKeyFromEntropy(entropy, '')).toThrow();
  });

  it('hashes arbitrary bytes to 32 bytes of entropy', () => {
    const sig = new Uint8Array(65).fill(9);
    expect(entropyFromBytes(sig)).toHaveLength(32);
    expect(entropyFromBytes(sig)).toEqual(entropyFromBytes(new Uint8Array(65).fill(9)));
  });

  it('keeps the frozen provider constants frozen', () => {
    // Snapshot — a change here rotates every user's identity. Be sure.
    expect(ETH_IDENTITY_MESSAGE).toBe(
      'Sign in to Holons.\n\nThis signature unlocks your Holons identity key. It costs no gas and sends no transaction.\n\nVersion: 1',
    );
    expect(bytesToHex(PASSKEY_PRF_SALT)).toBe('c70ecae19029fafac265c84bd9f1bc3b9942d7d277a49f920d2c4848d2939541');
    expect(PASSKEY_PRF_SALT).toHaveLength(32);
  });
});

describe('deriveIdentityProviderKey', () => {
  const secret = 'a-sufficiently-long-derivation-secret';

  it('is stable and follows the frozen entropy rule', () => {
    const k = deriveIdentityProviderKey(secret);
    expect(k).toEqual(deriveIdentityProviderKey(secret));
    expect(k).toEqual(
      deriveNostrKeyFromEntropy(new TextEncoder().encode(secret), IDENTITY_PROVIDER_CONTEXT),
    );
    expect(IDENTITY_PROVIDER_CONTEXT).toBe('service:identity-provider'); // frozen
  });

  it('is domain-separated from member keys under the same secret', () => {
    const provider = deriveIdentityProviderKey(secret).publicKey;
    expect(deriveTelegramNostrKey(42, secret).publicKey).not.toBe(provider);
    expect(deriveTelegramNostrKey(IDENTITY_PROVIDER_CONTEXT, secret).publicKey).not.toBe(provider);
  });

  it('refuses an empty secret', () => {
    expect(() => deriveIdentityProviderKey('')).toThrow(/NOSTR_DERIVATION_SECRET/);
  });
});

describe('holonIdForIdentity', () => {
  it('uses the Telegram id for Telegram and the pubkey otherwise', () => {
    expect(holonIdForIdentity({ provider: 'telegram', pubkey: 'ab', subject: '42' })).toBe('42');
    expect(holonIdForIdentity({ provider: 'ethereum', pubkey: 'ab', subject: '0x1' })).toBe('ab');
  });
});

describe('NIP-98 auth events', () => {
  const target = { url: 'https://app.example/api/auth/key', method: 'POST' };
  const sk = generateSecretKey();
  const now = 1_700_000_000;
  const signed = (overrides: Partial<ReturnType<typeof buildAuthEventTemplate>> = {}) =>
    finalizeEvent({ ...buildAuthEventTemplate(target, now), ...overrides }, sk);

  it('builds a kind-27235 template bound to url + method', () => {
    const t = buildAuthEventTemplate({ url: target.url, method: 'post' }, now);
    expect(t.kind).toBe(NIP98_KIND);
    expect(t.tags).toEqual([
      ['u', target.url],
      ['method', 'POST'],
    ]);
  });

  it('accepts a fresh, correctly bound, validly signed event', () => {
    const v = verifyAuthEvent(signed(), target, { now });
    expect(v).toEqual({ ok: true, pubkey: getPublicKey(sk) });
  });

  it('signs a proof from a hex key that verifies', () => {
    const ev = signAuthEvent(target, bytesToHex(sk), now);
    expect(verifyAuthEvent(ev, target, { now })).toEqual({ ok: true, pubkey: getPublicKey(sk) });
  });

  it('rejects an expired event', () => {
    expect(verifyAuthEvent(signed(), target, { now: now + 120 })).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects the wrong url or method', () => {
    expect(verifyAuthEvent(signed(), { ...target, url: 'https://evil/x' }, { now })).toEqual({
      ok: false,
      reason: 'wrong-url',
    });
    expect(verifyAuthEvent(signed(), { ...target, method: 'GET' }, { now })).toEqual({
      ok: false,
      reason: 'wrong-method',
    });
  });

  it('rejects a tampered signature and malformed input', () => {
    const ev = signed();
    expect(verifyAuthEvent({ ...ev, content: 'x' }, target, { now })).toEqual({ ok: false, reason: 'bad-signature' });
    expect(verifyAuthEvent(null, target).ok).toBe(false);
    expect(verifyAuthEvent({ ...ev, kind: 1 }, target, { now })).toEqual({ ok: false, reason: 'wrong-kind' });
  });
});
