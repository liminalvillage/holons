// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { generateSecretKey } from 'nostr-tools/pure';
import { isPin, openSecretKey, sealSecretKey } from './pin.js';

describe('a key at rest behind a PIN', () => {
  it('round-trips, refuses the wrong PIN, and rejects damaged input', () => {
    const sk = bytesToHex(generateSecretKey());
    const sealed = sealSecretKey(sk, '2468', { logn: 8 });
    expect(sealed.startsWith('ncryptsec1')).toBe(true);
    expect(openSecretKey(sealed, '2468')).toBe(sk);
    expect(openSecretKey(sealed, '2469')).toBeNull();
    expect(openSecretKey(sealed.slice(0, -4) + 'qqqq', '2468')).toBeNull();
    expect(openSecretKey('nsec1notsealed', '2468')).toBeNull();
    expect(sealSecretKey(sk, '2468', { logn: 8 })).not.toBe(sealed); // fresh salt each time
  });

  it('a PIN is 4–12 characters without spaces; a key is 64 hex', () => {
    expect(isPin('1234')).toBe(true);
    expect(isPin('123')).toBe(false);
    expect(isPin('12 34')).toBe(false);
    expect(isPin('x'.repeat(13))).toBe(false);
    expect(() => sealSecretKey('abc', '1234', { logn: 8 })).toThrow(/hex/);
    expect(() => sealSecretKey(bytesToHex(generateSecretKey()), '12', { logn: 8 })).toThrow(/PIN/);
  });
});
