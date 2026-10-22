// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { createHoloSphere } from '../holosphere/factory.js';
import { signerFromSecretKey } from '../holosphere/signers.js';
import { GROUP_ADMINS_KIND, GROUP_JOIN_REQUEST_KIND, GROUP_MEMBERS_KIND, GROUP_PUT_USER_KIND, GROUP_REMOVE_USER_KIND } from '../nostr/groups.js';
import type { NostrEventLike } from '../nostr/types.js';
import { holonMembers, isHolonId } from '../protocol/founding.js';
import { testKey } from '../protocol/testing.js';
import {
  approveJoin,
  createHolon,
  ensureProfile,
  forgetHolon,
  joinRequestFilter,
  leaveHolon,
  listJoinRequests,
  myHolons,
  parseJoinRequest,
  publishGroupState,
  rememberHolon,
  removeSeat,
  requestToJoin,
  watchJoinRequests,
} from './index.js';

const founder = testKey();
const alice = testKey();
const bob = testKey();
const APP = 'holons-test';

type Sub = (event: NostrEventLike) => void;

/** A local instance whose relay side is a capture: what was published, who subscribed. */
function instance(sk = founder.sk) {
  const hs = createHoloSphere({ appName: APP, privateKey: bytesToHex(sk), store: { adapter: 'memory' } });
  const published: NostrEventLike[] = [];
  const subs: Sub[] = [];
  const h = hs as unknown as { publishNostrEvents(e: unknown): void; subscribeNostr(f: unknown, cb: Sub): () => void };
  h.publishNostrEvents = (e) => published.push(...((Array.isArray(e) ? e : [e]) as NostrEventLike[]));
  h.subscribeNostr = (_f, cb) => {
    subs.push(cb);
    return () => subs.splice(subs.indexOf(cb), 1);
  };
  return { hs, published, subs, feed: (ev: NostrEventLike) => subs.forEach((s) => s(ev)) };
}
const signer = (sk: Uint8Array) => signerFromSecretKey(bytesToHex(sk));
const ptags = (e: NostrEventLike) => e.tags.filter((t) => t[0] === 'p');
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('join requests', () => {
  it('a request is a verified 9021 for the holon; anything else parses to null', () => {
    const { hs, published } = instance();
    const H = 'holon_aaaaaaaaaaaaaaaa';
    const ev = requestToJoin(hs, H, signer(alice.sk), { appName: APP, reason: 'Alice' });
    expect(published).toEqual([ev]);
    expect(ev.kind).toBe(GROUP_JOIN_REQUEST_KIND);
    expect(joinRequestFilter(H)).toEqual({ kinds: [GROUP_JOIN_REQUEST_KIND], '#h': [H] });
    expect(parseJoinRequest(ev, H)).toEqual({ pubkey: alice.pk, at: ev.created_at, reason: 'Alice', eventId: ev.id, holon: H });
    expect(parseJoinRequest(ev)).not.toBeNull();
    expect(parseJoinRequest(ev, 'holon_bbbbbbbbbbbbbbbb')).toBeNull();
    expect(parseJoinRequest({ ...ev, content: 'Mallory' }, H)).toBeNull(); // tampered: signature fails
    expect(parseJoinRequest({ ...ev, kind: 1 }, H)).toBeNull();
    expect(parseJoinRequest({ ...ev, tags: [] }, H)).toBeNull();
    expect(parseJoinRequest({ ...ev, sig: undefined }, H)).toBeNull();
    // Asking never writes a profile: nothing counts before the seat.
    expect(hs.store.listEventIds(H, 'users')).toEqual([]);
  });

  it('a watch keeps the newest request per key, drops seated keys, and stops', async () => {
    const { hs, published, subs, feed } = instance();
    const { holon: H } = await createHolon(hs, signer(founder.sk), { appName: APP, name: 'Orto' });
    expect(isHolonId(H)).toBe(true);
    await approveJoin(hs, H, bob.pk, signer(founder.sk), { appName: APP });
    const seen: string[][] = [];
    const stop = watchJoinRequests(hs, H, (reqs) => seen.push(reqs.map((r) => `${r.pubkey}:${r.reason}`)));
    await tick();
    const other = instance();
    const a1 = requestToJoin(other.hs, H, signer(alice.sk), { appName: APP, reason: 'Alice', now: () => 1_800_000_000 });
    const a2 = requestToJoin(other.hs, H, signer(alice.sk), { appName: APP, reason: 'Alice again', now: () => 1_800_000_010 });
    const b1 = requestToJoin(other.hs, H, signer(bob.sk), { appName: APP, reason: 'Bob' });
    feed(a2);
    feed(a1); // older: ignored
    feed(b1); // already seated: never listed
    feed({ ...a2, content: 'forged' }); // bad signature: ignored
    expect(seen.at(-1)).toEqual([`${alice.pk}:Alice again`]);
    expect(subs).toHaveLength(1);
    stop();
    expect(subs).toHaveLength(0);
    expect(published.every((e) => e.kind !== GROUP_JOIN_REQUEST_KIND)).toBe(true);
    const listed = await listJoinRequests(hs, H, { windowMs: 5 });
    expect(listed).toEqual([]);
  });
});

describe('seating and group state', () => {
  it('createHolon founds, publishes the state; approve/remove seat keys with 9000/9001 and refresh 39001/39002', async () => {
    const { hs, published } = instance();
    const { holon: H, anchor } = await createHolon(hs, signer(founder.sk), { appName: APP, name: 'Orto' });
    expect(anchor).toBe(founder.pk);
    expect(published.map((e) => e.kind).sort()).toEqual([GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND, 39000].sort());
    published.length = 0;

    expect(await approveJoin(hs, H, alice.pk, signer(founder.sk), { appName: APP })).toBe(alice.pk);
    expect((await holonMembers(hs, H)).get(alice.pk)).toBe('member');
    const put = published.find((e) => e.kind === GROUP_PUT_USER_KIND)!;
    expect(ptags(put)).toEqual([['p', alice.pk, 'member']]);
    const members = published.find((e) => e.kind === GROUP_MEMBERS_KIND)!;
    expect(ptags(members).map((t) => t[1]).sort()).toEqual([founder.pk, alice.pk].sort());
    expect(published.some((e) => e.kind === GROUP_ADMINS_KIND)).toBe(false); // admins unchanged
    published.length = 0;

    await approveJoin(hs, H, bob.pk, signer(founder.sk), { appName: APP, role: 'admin' });
    const admins = published.find((e) => e.kind === GROUP_ADMINS_KIND)!;
    expect(ptags(admins)).toEqual([['p', founder.pk, 'admin'], ['p', bob.pk, 'admin']]);
    published.length = 0;

    expect(await publishGroupState(hs, H, signer(founder.sk), { appName: APP })).toEqual([]); // nothing changed
    expect(published).toEqual([]);

    await removeSeat(hs, H, alice.pk, signer(founder.sk), { appName: APP });
    expect((await holonMembers(hs, H)).has(alice.pk)).toBe(false);
    expect(published.find((e) => e.kind === GROUP_REMOVE_USER_KIND)!.tags).toContainEqual(['p', alice.pk]);
    expect(ptags(published.find((e) => e.kind === GROUP_MEMBERS_KIND)!).map((t) => t[1]).sort()).toEqual([founder.pk, bob.pk].sort());

    const left = leaveHolon(hs, H, signer(bob.sk), { appName: APP });
    expect(left.kind).toBe(9022);
    expect(published.at(-1)).toBe(left);
    await hs.close();
  });

  it('a member may not seat anyone', async () => {
    const { hs } = instance();
    const { holon: H } = await createHolon(hs, signer(founder.sk), { appName: APP });
    await approveJoin(hs, H, alice.pk, signer(founder.sk), { appName: APP });
    await hs.login(bytesToHex(alice.sk));
    await expect(approveJoin(hs, H, bob.pk, signer(alice.sk), { appName: APP })).rejects.toThrow(/admin/);
    await hs.close();
  });
});

describe('approveJoin seeds the joiner from their request', () => {
  it('writes their record with the name they gave, once, never a placeholder, and the joiner can replace it', async () => {
    const { hs } = instance();
    const { holon: H } = await createHolon(hs, signer(founder.sk), { appName: APP });
    await approveJoin(hs, H, alice.pk, signer(founder.sk), { appName: APP, name: '  Alice  ' });
    expect(await hs.get(H, 'users', alice.pk)).toMatchObject({ id: alice.pk, first_name: 'Alice' });
    await approveJoin(hs, H, bob.pk, signer(founder.sk), { appName: APP, name: `${'npub1'}${'q'.repeat(58)}` });
    expect(await hs.get(H, 'users', bob.pk)).toBeNull();
    await hs.login(bytesToHex(alice.sk));
    await hs.put(H, 'users', { id: alice.pk, first_name: 'Alicia' });
    expect((await hs.get(H, 'users', alice.pk)).first_name).toBe('Alicia');
    await hs.close();
  });
});

describe('ensureProfile', () => {
  it('never persists a placeholder name', async () => {
    const { hs } = instance();
    const { holon: H } = await createHolon(hs, signer(founder.sk), { appName: APP });
    await approveJoin(hs, H, alice.pk, signer(founder.sk), { appName: APP });
    await hs.login(bytesToHex(alice.sk));
    const { shortId } = await import('../identity/ids.js');
    expect(await ensureProfile(hs, H, { first_name: shortId(alice.pk), picture: 'https://x/a.png' })).toBe(true);
    expect(await hs.get(H, 'users', alice.pk)).toEqual(expect.objectContaining({ id: alice.pk, picture: 'https://x/a.png' }));
    expect((await hs.get(H, 'users', alice.pk)).first_name).toBeUndefined();
    await hs.close();
  });

  it('writes once, only for a seated key, and never counts a pre-seat record', async () => {
    const { hs } = instance();
    const { holon: H } = await createHolon(hs, signer(founder.sk), { appName: APP });
    await hs.login(bytesToHex(alice.sk));
    expect(await ensureProfile(hs, H, { first_name: 'Alice' })).toBe(false); // not seated: nothing written
    expect(hs.store.listEventIds(H, 'users')).toEqual([]);

    await hs.login(bytesToHex(founder.sk));
    await approveJoin(hs, H, alice.pk, signer(founder.sk), { appName: APP });
    await hs.login(bytesToHex(alice.sk));
    expect(await ensureProfile(hs, H, { first_name: 'Alice', username: ' alice ', picture: '' })).toBe(true);
    expect(await hs.get(H, 'users', alice.pk)).toMatchObject({ id: alice.pk, first_name: 'Alice', username: 'alice' });
    expect(await ensureProfile(hs, H, { first_name: 'Alice' })).toBe(false);
    expect(hs.store.getEvents(H, 'users', alice.pk)).toHaveLength(1);
    await hs.close();
  });
});

describe('my holons', () => {
  it('remembers, keeps a learned name, orders by recency, forgets', async () => {
    const rows = new Map<string, unknown>();
    const store = {
      getAll: async () => [...rows.values()],
      put: async (_h: string, _l: string, d: object) => void rows.set((d as { id: string }).id, d),
      delete: async (_h: string, _l: string, k: string) => void rows.delete(k),
    };
    await rememberHolon(store, founder.pk, { id: 'holon_a', name: 'Orto' }, 10);
    await rememberHolon(store, founder.pk, { id: '-1001', name: 'Liminal' }, 20);
    await rememberHolon(store, founder.pk, { id: 'holon_a', name: '' }, 30);
    expect(await myHolons(store, founder.pk)).toEqual([
      { id: 'holon_a', name: 'Orto', at: 30 },
      { id: '-1001', name: 'Liminal', at: 20 },
    ]);
    await forgetHolon(store, founder.pk, '-1001');
    rows.set('junk', { id: '', at: 1 });
    expect(await myHolons(store, founder.pk)).toEqual([{ id: 'holon_a', name: 'Orto', at: 30 }]);
    await expect(rememberHolon(store, founder.pk, { id: ' ' })).rejects.toThrow();
  });
});
