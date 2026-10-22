// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// A key at rest on a device, behind a PIN: NIP-49 (`ncryptsec…`, scrypt +
// XChaCha20-Poly1305). This is what "stay signed in on this device" stores —
// never the bare secret. Opening it costs about a second at the default
// work factor, which is the point; specs pass a small `logn`.

import { decrypt, encrypt } from 'nostr-tools/nip49';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

const HEX64 = /^[0-9a-f]{64}$/i;
/** Fewest digits a PIN may have. Short, since it only guards a device, not the relay. */
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 12;

export function isPin(value: unknown): value is string {
  return typeof value === 'string' && value.length >= PIN_MIN_LENGTH && value.length <= PIN_MAX_LENGTH && !/\s/.test(value);
}

/** Seal a 64-hex secret key under `pin` → an `ncryptsec1…` string. */
export function sealSecretKey(secretHex: string, pin: string, opts: { logn?: number } = {}): string {
  if (!HEX64.test(secretHex)) throw new Error('sealSecretKey: expected a 64-char hex secret key');
  if (!isPin(pin)) throw new Error(`sealSecretKey: a PIN is ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} characters with no spaces`);
  return encrypt(hexToBytes(secretHex.toLowerCase()), pin, opts.logn ?? 16);
}

/** Open an `ncryptsec1…` with `pin` → the 64-hex secret key, or null (wrong PIN, damaged blob). */
export function openSecretKey(ncryptsec: string, pin: string): string | null {
  if (typeof ncryptsec !== 'string' || !ncryptsec.startsWith('ncryptsec1') || typeof pin !== 'string') return null;
  try {
    const sk = decrypt(ncryptsec, pin);
    return sk.length === 32 ? bytesToHex(sk) : null;
  } catch {
    return null;
  }
}
