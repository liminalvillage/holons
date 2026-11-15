// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Taking your own key with you: the encodings a person needs to carry their
// signing identity into another Nostr client — the npub to share, the nsec
// to paste, and a NIP-49 backup (`ncryptsec…`) sealed under a password they
// choose. Pure: nothing is stored, sent or logged here; the UI decides where
// the bytes go (a clipboard, a downloaded file) and nothing else does.
//
// The backup uses the same NIP-49 wrap as the device PIN (pin.ts), but with
// a password, not a PIN: a file travels and can be attacked offline, so it
// asks for more than a device guard does.

import * as nip19 from 'nostr-tools/nip19';
import { encrypt } from 'nostr-tools/nip49';
import { hexToBytes } from '@noble/hashes/utils';
import { getPublicKey } from 'nostr-tools/pure';
import { openSecretKey } from './pin.js';

const HEX64 = /^[0-9a-f]{64}$/i;

/** Fewest characters a backup password may have. */
export const BACKUP_PASSWORD_MIN = 8;

function assertHex(hex: string, what: string): void {
  if (typeof hex !== 'string' || !HEX64.test(hex)) throw new Error(`${what}: expected a 64-char hex key`);
}

/** `npub1…` for a 64-hex public key. */
export function npubOf(pubkeyHex: string): string {
  assertHex(pubkeyHex, 'npubOf');
  return nip19.npubEncode(pubkeyHex.toLowerCase());
}

/** `nsec1…` for a 64-hex secret key. */
export function nsecOf(secretHex: string): string {
  assertHex(secretHex, 'nsecOf');
  return nip19.nsecEncode(hexToBytes(secretHex.toLowerCase()));
}

/** The 64-hex public key behind a 64-hex secret key. */
export function pubkeyOfSecret(secretHex: string): string {
  assertHex(secretHex, 'pubkeyOfSecret');
  return getPublicKey(hexToBytes(secretHex.toLowerCase()));
}

/** Why a backup password pair is refused, or null when it is usable. */
export type BackupPasswordProblem = 'short' | 'mismatch';

/**
 * Check the password typed twice. Length first: a short password is the
 * problem to fix even when the two happen to differ.
 */
export function backupPasswordProblem(password: string, again: string): BackupPasswordProblem | null {
  if (typeof password !== 'string' || [...password].length < BACKUP_PASSWORD_MIN) return 'short';
  if (password !== again) return 'mismatch';
  return null;
}

/** `holons-key-<first 8 of the npub's data>.ncryptsec.txt` — names whose key it is without giving it away. */
export function keyBackupFileName(pubkeyHex: string): string {
  return `holons-key-${npubOf(pubkeyHex).slice('npub1'.length, 'npub1'.length + 8)}.ncryptsec.txt`;
}

export type KeyBackup =
  | { ok: true; ncryptsec: string; fileName: string; text: string }
  | { ok: false; problem: BackupPasswordProblem };

/**
 * Seal `secretHex` under the password typed twice → an `ncryptsec1…` and the
 * file to save it as. The file holds the ncryptsec alone (plus a newline), so
 * any NIP-49 client can import it by paste. Slow on purpose (scrypt at
 * logn 16 by default, about a second); `logn` is for specs.
 */
export function sealKeyBackup(
  secretHex: string,
  password: string,
  again: string,
  opts: { logn?: number } = {},
): KeyBackup {
  assertHex(secretHex, 'sealKeyBackup');
  const problem = backupPasswordProblem(password, again);
  if (problem) return { ok: false, problem };
  const ncryptsec = encrypt(hexToBytes(secretHex.toLowerCase()), password, opts.logn ?? 16);
  return {
    ok: true,
    ncryptsec,
    fileName: keyBackupFileName(pubkeyOfSecret(secretHex)),
    text: `${ncryptsec}\n`,
  };
}

/** Open a backup (`ncryptsec1…`, surrounding whitespace allowed) → the 64-hex secret, or null. */
export function openKeyBackup(text: string, password: string): string | null {
  return typeof text === 'string' ? openSecretKey(text.trim(), password) : null;
}
