// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { verifyEvent, logRefs } from 'holosphere/nostr-events.js';
import { signerFromSecretKey } from '../holosphere/signers.js';
import { action, attestation, attestationTarget, attestationVerdict, logTemplate, recordType, LOG_KIND } from './events.js';
import { signedEntry, testKey } from './testing.js';

describe('logTemplate', () => {
  it('is the unsigned twin of a log entry, ready for a host-held signer', () => {
    const k = testKey();
    const a = action('claim', { amount: 3 }, { prev: 'p1' });
    const t = logTemplate({ holon: 'h1', lens: 'flow_claims', appName: 'app', item: a.item, refs: a.refs, created_at: 1_760_000_000 });
    expect(t.kind).toBe(LOG_KIND);
    expect(t.tags).toEqual([['h', 'h1'], ['l', 'flow_claims'], ['e', 'p1', '', 'prev'], ['n', 'app']]);
    const ev = signerFromSecretKey(bytesToHex(k.sk)).sign(t);
    expect(verifyEvent(ev)).toBe(true);
    expect(ev.pubkey).toBe(k.pk);
    expect(logRefs(ev).prev).toEqual(['p1']);
    expect(JSON.parse(ev.content)).toEqual({ t: 'action', kind: 'claim', amount: 3 });
  });
});

describe('records', () => {
  it('an action carries its kind and body; refs go on the tags', () => {
    const a = action('claim', { amount: 3, t: 'junk', kind: 'junk' }, { prev: 'p1', basis: ['b1'] });
    expect(a.item).toEqual({ t: 'action', kind: 'claim', amount: 3 });
    expect(a.refs).toEqual({ prev: 'p1', basis: ['b1'] });
    const e = signedEntry({ sk: testKey().sk, item: a.item, refs: a.refs });
    expect(e.refs.prev).toEqual(['p1']);
    expect(e.refs.basis).toEqual(['b1']);
    expect(recordType(e.item)).toBe('action');
  });

  it('an attestation names its target through the ref marker', () => {
    const att = attestation('t1', 'dispute', 'wrong amount');
    const e = signedEntry({ sk: testKey().sk, item: att.item as unknown as Record<string, unknown>, refs: att.refs });
    expect(attestationTarget(e)).toBe('t1');
    expect(attestationVerdict(e)).toBe('dispute');
    expect(recordType(e.item)).toBe('attestation');
    expect(recordType({ t: 'checkpoint', lens: 'x', root: 'r' })).toBe('checkpoint');
    expect(recordType({ hello: 1 })).toBeNull();
  });
});
