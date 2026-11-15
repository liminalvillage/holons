// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as nip19 from 'nostr-tools/nip19';
import { bytesToHex } from '@noble/hashes/utils';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import {
  BACKUP_PASSWORD_MIN,
  backupPasswordProblem,
  keyBackupFileName,
  npubOf,
  nsecOf,
  openKeyBackup,
  pubkeyOfSecret,
  sealKeyBackup,
} from './keyexport.js';

const fresh = () => {
  const bytes = generateSecretKey();
  return { sk: bytesToHex(bytes), pk: getPublicKey(bytes) };
};

describe('exporting your own key', () => {
  it('encodes npub and nsec that decode back to the same key', () => {
    const { sk, pk } = fresh();
    const npub = npubOf(pk);
    const nsec = nsecOf(sk);
    expect(npub.startsWith('npub1')).toBe(true);
    expect(nsec.startsWith('nsec1')).toBe(true);
    expect(nip19.decode(npub)).toEqual({ type: 'npub', data: pk });
    const back = nip19.decode(nsec);
    expect(back.type).toBe('nsec');
    expect(bytesToHex(back.data as Uint8Array)).toBe(sk);
    expect(pubkeyOfSecret(sk.toUpperCase())).toBe(pk);
    expect(() => nsecOf('nsec1abc')).toThrow(/hex/);
    expect(() => npubOf('')).toThrow(/hex/);
  });

  it('round-trips a password backup and refuses the wrong password', () => {
    const { sk, pk } = fresh();
    const b = sealKeyBackup(sk, 'correct horse', 'correct horse', { logn: 8 });
    if (!b.ok) throw new Error('expected a backup');
    expect(b.ncryptsec.startsWith('ncryptsec1')).toBe(true);
    expect(b.text).toBe(`${b.ncryptsec}\n`);
    expect(b.text).not.toContain(nsecOf(sk));
    expect(b.text).not.toContain(sk);
    expect(openKeyBackup(b.text, 'correct horse')).toBe(sk);
    expect(openKeyBackup(b.text, 'correct horsf')).toBeNull();
    expect(b.fileName).toBe(`holons-key-${npubOf(pk).slice(5, 13)}.ncryptsec.txt`);
    expect(b.fileName).toMatch(/^holons-key-[02-9ac-hj-np-z]{8}\.ncryptsec\.txt$/);
    expect(keyBackupFileName(pk)).toBe(b.fileName);
  });

  it('refuses a password typed differently the second time', () => {
    const { sk } = fresh();
    expect(backupPasswordProblem('longenough', 'longenougH')).toBe('mismatch');
    expect(sealKeyBackup(sk, 'longenough', 'longenougH', { logn: 8 })).toEqual({ ok: false, problem: 'mismatch' });
  });

  it(`refuses a password shorter than ${BACKUP_PASSWORD_MIN} characters, even typed twice`, () => {
    const { sk } = fresh();
    const short = 'x'.repeat(BACKUP_PASSWORD_MIN - 1);
    expect(backupPasswordProblem(short, short)).toBe('short');
    expect(backupPasswordProblem(short, 'other')).toBe('short');
    expect(backupPasswordProblem('', '')).toBe('short');
    expect(sealKeyBackup(sk, short, short, { logn: 8 })).toEqual({ ok: false, problem: 'short' });
    const ok = 'x'.repeat(BACKUP_PASSWORD_MIN);
    expect(backupPasswordProblem(ok, ok)).toBeNull();
  });
});
