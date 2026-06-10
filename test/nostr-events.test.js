/**
 * NIP-01 signing primitives for HoloSphere events.
 * See nostr-events.js and NOSTR-SIGNING-PLAN.md.
 */
import { schnorr } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import {
  getEventHash,
  getPublicKey,
  buildEvent,
  signEvent,
  verifyEvent,
  eventToItem,
  tag,
  HOLOSPHERE_KIND,
} from '../nostr-events.js';

describe('nostr-events: signing & verification', () => {
  test('key derivation matches noble schnorr (x-only)', () => {
    const sk = bytesToHex(schnorr.utils.randomPrivateKey());
    expect(getPublicKey(sk)).toBe(bytesToHex(schnorr.getPublicKey(sk)));
  });

  test('sk=...0001 yields the secp256k1 generator x-coordinate', () => {
    // Sanity vector: private key 1 -> generator point G, x = 79be667e…
    const pub = getPublicKey('0000000000000000000000000000000000000000000000000000000000000001');
    expect(pub).toBe('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
  });

  test('event id is the deterministic NIP-01 hash (regression vector)', () => {
    const ev = {
      pubkey: '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      created_at: 1700000000,
      kind: 30078,
      tags: [['h', '892830'], ['l', 'tasks'], ['d', 'task-1']],
      content: '{"id":"task-1"}',
    };
    expect(getEventHash(ev)).toBe('d953d33bd111aca2f127e844a2d4d7ad7dba4c461b5e78a5e0da5357e7dd3461');
  });

  test('buildEvent produces a verifiable, well-tagged event', () => {
    const sk = bytesToHex(schnorr.utils.randomPrivateKey());
    const item = { id: 'task-001', title: 'Repair the well' };
    const ev = buildEvent({ holon: '89283082803ffff', lens: 'tasks', item, sk });

    expect(ev.kind).toBe(HOLOSPHERE_KIND);
    expect(tag(ev, 'h')).toBe('89283082803ffff');
    expect(tag(ev, 'l')).toBe('tasks');
    expect(tag(ev, 'd')).toBe('task-001'); // d-tag == item.id (NIP-33 replaceable key)
    expect(verifyEvent(ev)).toBe(true);
    expect(eventToItem(ev)).toEqual(item);
  });

  test('signEvent then verifyEvent round-trips', () => {
    const sk = bytesToHex(schnorr.utils.randomPrivateKey());
    const ev = signEvent({ kind: 30078, tags: [['d', 'x']], content: 'hello', created_at: 1700000000 }, sk);
    expect(ev.id).toHaveLength(64);
    expect(ev.sig).toHaveLength(128);
    expect(verifyEvent(ev)).toBe(true);
  });

  test('tampered content fails verification', () => {
    const sk = bytesToHex(schnorr.utils.randomPrivateKey());
    const ev = buildEvent({ holon: 'h', lens: 'l', item: { id: 'i', v: 1 }, sk });
    expect(verifyEvent({ ...ev, content: JSON.stringify({ id: 'i', v: 999 }) })).toBe(false);
  });

  test('invalid / foreign signature fails verification', () => {
    const sk = bytesToHex(schnorr.utils.randomPrivateKey());
    const ev = buildEvent({ holon: 'h', lens: 'l', item: { id: 'i' }, sk });
    expect(verifyEvent({ ...ev, sig: '00'.repeat(64) })).toBe(false);

    // a signature from a different key over a different id must not verify here
    const otherSk = bytesToHex(schnorr.utils.randomPrivateKey());
    const other = buildEvent({ holon: 'h', lens: 'l', item: { id: 'i' }, sk: otherSk });
    expect(verifyEvent({ ...ev, sig: other.sig })).toBe(false);
  });

  test('forging another author: changing pubkey breaks the signature', () => {
    const sk = bytesToHex(schnorr.utils.randomPrivateKey());
    const ev = buildEvent({ holon: 'h', lens: 'l', item: { id: 'i' }, sk });
    const victim = getPublicKey(bytesToHex(schnorr.utils.randomPrivateKey()));
    // claim to be the victim while keeping the original sig -> id changes, verify fails
    expect(verifyEvent({ ...ev, pubkey: victim })).toBe(false);
  });
});
