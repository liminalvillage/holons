// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { deriveTelegramNostrKey } from '../auth/derive.js';
import { createHoloSphere } from '../holosphere/factory.js';
import { signerFromSecretKey } from '../holosphere/signers.js';
import { GROUP_JOIN_REQUEST_KIND } from '../nostr/groups.js';
import type { NostrEventLike } from '../nostr/types.js';
import { testKey } from '../protocol/testing.js';
import {
  JOIN_REQUESTS_LENS,
  approveJoin,
  approvedJoinKeys,
  createHolon,
  describeApplicant,
  joinRequestRecords,
  parseJoinRequest,
  recordJoinRequest,
  removeSeat,
  requestToJoin,
  settleJoinRequest,
  watchAllJoinRequests,
} from './index.js';

const founder = testKey();
const alice = testKey();
const bob = testKey();
const APP = 'holons-test';
const SECRET = 'derivation-secret-for-tests';

type Sub = (event: NostrEventLike) => void;

function instance(sk = founder.sk) {
  const hs = createHoloSphere({ appName: APP, privateKey: bytesToHex(sk), store: { adapter: 'memory' } });
  const filters: Record<string, unknown>[] = [];
  const subs: Sub[] = [];
  const h = hs as unknown as { publishNostrEvents(e: unknown): void; subscribeNostr(f: Record<string, unknown>, cb: Sub): () => void };
  h.publishNostrEvents = () => {};
  h.subscribeNostr = (f, cb) => {
    filters.push(f);
    subs.push(cb);
    return () => subs.splice(subs.indexOf(cb), 1);
  };
  return { hs, filters, subs, feed: (ev: NostrEventLike) => subs.forEach((s) => s(ev)) };
}
const signer = (sk: Uint8Array) => signerFromSecretKey(bytesToHex(sk));

describe('a join request names its holon and may claim a Telegram identity', () => {
  it('carries the claim as an `i` tag and parses it back; a malformed claim is dropped', () => {
    const { hs } = instance();
    const ev = requestToJoin(hs, '-1001234', signer(alice.sk), { appName: APP, reason: 'Alice', telegramId: 4242 });
    expect(ev.tags).toContainEqual(['i', 'telegram:4242']);
    expect(parseJoinRequest(ev)).toMatchObject({ holon: '-1001234', telegramId: '4242', pubkey: alice.pk });
    const plain = requestToJoin(hs, '-1001234', signer(alice.sk), { appName: APP, telegramId: 'not-a-number' });
    expect(plain.tags.some((t) => t[0] === 'i')).toBe(false);
    expect(parseJoinRequest(plain)?.telegramId).toBeUndefined();
  });

  it('one watch hears every holon of the namespace through a single filter', () => {
    const { hs, filters, subs, feed } = instance();
    const seen: string[] = [];
    const stop = watchAllJoinRequests(hs, { appName: APP, since: 1_800_000_000.7 }, (r) => seen.push(`${r.holon}:${r.pubkey}`));
    expect(filters).toEqual([{ kinds: [GROUP_JOIN_REQUEST_KIND], '#n': [APP], since: 1_800_000_000 }]);
    const a = requestToJoin(hs, '-1001', signer(alice.sk), { appName: APP });
    const b = requestToJoin(hs, 'holon_aaaaaaaaaaaaaaaa', signer(bob.sk), { appName: APP });
    feed(a);
    feed(b);
    feed({ ...a, content: 'forged' });
    expect(seen).toEqual([`-1001:${alice.pk}`, `holon_aaaaaaaaaaaaaaaa:${bob.pk}`]);
    stop();
    expect(subs).toHaveLength(0);
  });
});

describe('describeApplicant', () => {
  it('proves a Telegram claim only when the derived key signed the request', async () => {
    const { hs } = instance();
    const derived = deriveTelegramNostrKey('4242', SECRET);
    const real = parseJoinRequest(requestToJoin(hs, '-1001', signerFromSecretKey(derived.privateKey), { appName: APP, reason: 'Ada', telegramId: '4242' }))!;
    expect(await describeApplicant(hs, real, { secret: SECRET })).toEqual({ name: 'Ada', telegram: { id: '4242', verified: true } });
    // Without the secret nothing is proven.
    expect((await describeApplicant(hs, real)).telegram).toEqual({ id: '4242', verified: false });
    // Someone else's key claiming the same Telegram user.
    const forged = parseJoinRequest(requestToJoin(hs, '-1001', signer(alice.sk), { appName: APP, reason: 'Ada', telegramId: '4242' }))!;
    expect((await describeApplicant(hs, forged, { secret: SECRET })).telegram).toEqual({ id: '4242', verified: false });
    await hs.close();
  });

  it('falls back to the short key when the request gives no usable name', async () => {
    const { hs } = instance();
    const req = parseJoinRequest(requestToJoin(hs, '-1001', signer(alice.sk), { appName: APP }))!;
    const who = await describeApplicant(hs, req);
    expect(who.telegram).toBeUndefined();
    expect(who.name).toBeTruthy();
    expect(who.name).not.toBe(alice.pk);
    await hs.close();
  });
});

describe('the join-request ledger', () => {
  it('remembers an announcement, then the decision; approved keys are listed until declined', async () => {
    const { hs } = instance();
    const { holon: H } = await createHolon(hs, signer(founder.sk), { appName: APP });
    const req = parseJoinRequest(requestToJoin(hs, H, signer(alice.sk), { appName: APP, reason: 'Alice' }))!;
    expect(await settleJoinRequest(hs, H, alice.pk, 'approved')).toBeNull(); // nothing recorded yet
    await recordJoinRequest(hs, H, req, { messageId: 77, now: () => 1_800_000_000 });
    expect((await joinRequestRecords(hs, H)).get(alice.pk)).toMatchObject({ eventId: req.eventId, name: 'Alice', status: 'pending', messageId: 77 });
    expect(await approvedJoinKeys(hs, H)).toEqual([]);
    expect(await settleJoinRequest(hs, H, alice.pk, 'approved', { by: 99, now: () => 1_800_000_010 })).toMatchObject({ status: 'approved', by: '99', messageId: 77 });
    expect(await approvedJoinKeys(hs, H)).toEqual([alice.pk]);
    await settleJoinRequest(hs, H, alice.pk, 'declined', { now: () => 1_800_000_020 });
    expect(await approvedJoinKeys(hs, H)).toEqual([]);
    await hs.close();
  });

  it('unseating a key withdraws its approval', async () => {
    const { hs } = instance();
    const { holon: H } = await createHolon(hs, signer(founder.sk), { appName: APP });
    const req = parseJoinRequest(requestToJoin(hs, H, signer(alice.sk), { appName: APP, reason: 'Alice' }))!;
    await recordJoinRequest(hs, H, req, { status: 'approved', now: () => 1_800_000_000 });
    await approveJoin(hs, H, alice.pk, signer(founder.sk), { appName: APP });
    expect(await approvedJoinKeys(hs, H)).toEqual([alice.pk]);
    await removeSeat(hs, H, alice.pk, signer(founder.sk), { appName: APP });
    expect(await approvedJoinKeys(hs, H)).toEqual([]);
    await hs.close();
  });

  it("a member's own approval never counts: only an admin's record does", async () => {
    const { hs } = instance();
    const { holon: H } = await createHolon(hs, signer(founder.sk), { appName: APP });
    await approveJoin(hs, H, alice.pk, signer(founder.sk), { appName: APP });
    await new Promise((r) => setTimeout(r, 1100)); // past the seat's second
    await hs.login(bytesToHex(alice.sk));
    await hs.put(H, JOIN_REQUESTS_LENS, { id: bob.pk, eventId: 'e'.repeat(64), name: 'Bob', status: 'approved', at: 1 });
    expect(await approvedJoinKeys(hs, H)).toEqual([]);
    expect((await joinRequestRecords(hs, H)).has(bob.pk)).toBe(false);
    await hs.close();
  });
});
