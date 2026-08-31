// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils';
import { deriveIdentityProviderKey, deriveTelegramNostrKey } from '../auth/derive.js';
import { createIdentityContext, signerFromSecretKey } from './signers.js';

const template = { kind: 1, created_at: 1_700_000_000, tags: [] as string[][], content: 'hi' };

describe('signerFromSecretKey', () => {
  it('signs verifiable events under the matching pubkey', () => {
    const sk = generateSecretKey();
    const signer = signerFromSecretKey(bytesToHex(sk));
    expect(signer.pubkey).toBe(getPublicKey(sk));
    const event = signer.sign(template);
    expect(event.pubkey).toBe(signer.pubkey);
    expect(verifyEvent(event)).toBe(true);
  });

  it('rejects a malformed key', () => {
    expect(() => signerFromSecretKey('not-hex')).toThrow();
    expect(() => signerFromSecretKey('ab'.repeat(16))).toThrow();
  });
});

describe('createIdentityContext', () => {
  const secret = 'a-sufficiently-long-derivation-secret';

  it('member signer matches the frozen telegram derivation', () => {
    const ctx = createIdentityContext({ derivationSecret: secret });
    const expected = deriveTelegramNostrKey(42, secret).publicKey;
    expect(ctx.memberPubkey(42)).toBe(expected);
    const event = ctx.memberSigner('42')!.sign(template);
    expect(event.pubkey).toBe(expected);
    expect(verifyEvent(event)).toBe(true);
  });

  it('provider signer matches the identity-provider derivation', () => {
    const ctx = createIdentityContext({ derivationSecret: secret });
    expect(ctx.providerPubkey()).toBe(deriveIdentityProviderKey(secret).publicKey);
    expect(verifyEvent(ctx.providerSigner()!.sign(template))).toBe(true);
  });

  it('degrades to null without a secret', () => {
    const ctx = createIdentityContext({});
    expect(ctx.memberSigner(42)).toBeNull();
    expect(ctx.memberPubkey(42)).toBeNull();
    expect(ctx.providerSigner()).toBeNull();
    expect(ctx.providerPubkey()).toBeNull();
  });
});
