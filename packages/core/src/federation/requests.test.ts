// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { HoloSphere } from 'holosphere';
import { createHoloSphere } from '../holosphere/factory.js';
import { testKey } from '../protocol/testing.js';
import type { NostrEventLike } from '../nostr/types.js';
import { removeFederationPartner, setFederationPartner } from './partners.js';
import {
  FEDERATION_REQUESTS_LENS,
  answerFederationRequest,
  askFederation,
  federationLinkState,
  federationRequestRecords,
  laneState,
  markFederationRequestAnnounced,
  pendingFederationRequests,
  watchAllFederationRequests,
} from './requests.js';
import { getFederationSnapshot } from './snapshot.js';

const APP = 'core-fedrequests-test';
const T0 = 1_700_000_000;

type Store = { exportEvents(o?: object): unknown[]; apply(e: unknown, o?: object): unknown };
type Host = HoloSphere & { store: Store; _readAuthority?: { invalidate(h?: string): void } };

function sphere(sk: string): Host {
  return createHoloSphere({ appName: APP, privateKey: sk, store: { adapter: 'memory' } }) as Host;
}

/** Copy every event between the instances — a relay they all share. */
function share(...spheres: Host[]): void {
  const events = spheres.flatMap((s) => s.store.exportEvents());
  for (const s of spheres) {
    for (const e of events) s.store.apply(e, { origin: 'remote', verify: false });
    s._readAuthority?.invalidate();
  }
}

/** A: alice's holon; B: bob's holon; the bot is admin of both; eve of neither. */
async function world(tag: string) {
  const alice = testKey(), bob = testKey(), bot = testKey(), eve = testKey();
  const A = `-1${tag}1`, B = `-1${tag}2`;
  const a = sphere(alice.sk), b = sphere(bob.sk), o = sphere(bot.sk), e = sphere(eve.sk);
  await Promise.all([a.ready(), b.ready(), o.ready(), e.ready()]);
  await o.foundHolon(A, { at: T0 });
  await o.foundHolon(B, { at: T0 });
  await o.addMember(A, alice.pk, 'admin', { at: T0 + 1 });
  await o.addMember(B, bob.pk, 'admin', { at: T0 + 1 });
  const all = [a, b, o, e];
  share(...all);
  return { A, B, a, b, o, e, sync: () => share(...all) };
}

describe('linking across two holons with different admins', () => {
  it("writes A's half and ASKS B; B's admin accepts and the flow is agreed", async () => {
    const { A, B, a, b, sync } = await world('10');
    const out = await setFederationPartner(a, A, B, { inbound: ['library'], outbound: [], holonName: 'Lunation' });
    expect(out).toEqual({ self: 'linked', partner: 'requested' });
    sync();

    // A's half counts; B's record says nothing yet.
    expect((await getFederationSnapshot(b, A)).lensConfig[B]).toEqual({ inbound: ['library'], outbound: [] });
    expect((await getFederationSnapshot(b, B)).federated).not.toContain(A);

    const pending = await pendingFederationRequests(b, B);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ from: A, to: B, kind: 'link', inbound: [], outbound: ['library'], fromName: 'Lunation', status: 'pending' });

    const before = await federationLinkState(a, A, B);
    expect(before.outgoing?.from).toBe(A);
    expect(laneState(before, 'library', 'in')).toBe('waiting');

    const answered = await answerFederationRequest(b, B, A, 'accept', { by: 'bob' });
    expect(answered?.status).toBe('accepted');
    sync();

    expect((await getFederationSnapshot(a, B)).lensConfig[A]).toEqual({ inbound: [], outbound: ['library'] });
    expect(await pendingFederationRequests(b, B)).toEqual([]);
    const after = await federationLinkState(a, A, B);
    expect(after.outgoing).toBeNull();
    expect(laneState(after, 'library', 'in')).toBe('agreed');
  });

  it("a decline leaves B's half alone and the request settled", async () => {
    const { A, B, a, b, sync } = await world('11');
    await setFederationPartner(a, A, B, { inbound: [], outbound: ['quests'] });
    sync();
    await answerFederationRequest(b, B, A, 'decline');
    sync();
    expect((await getFederationSnapshot(a, B)).federated).not.toContain(A);
    expect(await pendingFederationRequests(b, B)).toEqual([]);
    expect((await federationRequestRecords(a, B)).get(A)?.status).toBe('declined');
  });

  it('asks nothing when B already has the mirrored half', async () => {
    const { A, B, a, b, sync } = await world('12');
    await setFederationPartner(b, B, A, { inbound: ['quests'], outbound: [] });
    sync();
    const out = await setFederationPartner(a, A, B, { inbound: [], outbound: ['quests'] });
    expect(out).toEqual({ self: 'linked', partner: 'unchanged' });
    sync();
    expect(await pendingFederationRequests(a, A)).toEqual([]);
  });

  it("unlinking asks B to drop its half; accepting removes it", async () => {
    const { A, B, a, b, o, sync } = await world('13');
    await setFederationPartner(o, A, B, { inbound: ['library'], outbound: [] }); // the bot speaks for both
    sync();
    const out = await removeFederationPartner(a, A, B);
    expect(out).toEqual({ self: 'removed', partner: 'requested' });
    sync();
    const [req] = await pendingFederationRequests(b, B);
    expect(req).toMatchObject({ from: A, kind: 'unlink' });
    await answerFederationRequest(b, B, A, 'accept');
    sync();
    expect((await getFederationSnapshot(a, B)).federated).not.toContain(A);
  });

  it('a link with no flows yet is a link, not an unlink', async () => {
    const { A, B, a, b, sync } = await world('14');
    await setFederationPartner(a, A, B, { inbound: [], outbound: [] });
    sync();
    const [req] = await pendingFederationRequests(b, B);
    expect(req).toMatchObject({ kind: 'link', inbound: [], outbound: [] });
    await answerFederationRequest(b, B, A, 'accept');
    sync();
    expect((await getFederationSnapshot(a, B)).federated).toContain(A);
  });
});

describe('who may decide', () => {
  it('a key that speaks for both writes both halves — unless told to ask', async () => {
    const { A, B, o, sync } = await world('20');
    expect(await setFederationPartner(o, A, B, { inbound: ['library'], outbound: [] })).toEqual({ self: 'linked', partner: 'linked' });
    sync();
    expect((await getFederationSnapshot(o, B)).lensConfig[A]).toEqual({ inbound: [], outbound: ['library'] });

    const viaBot = await setFederationPartner(o, A, B, { inbound: ['stock'], outbound: [], askPartner: true });
    expect(viaBot).toEqual({ self: 'linked', partner: 'requested' });
  });

  it('a key that does not speak for the holon writes nothing', async () => {
    const { A, B, e, sync } = await world('21');
    expect(await setFederationPartner(e, A, B, { inbound: ['library'], outbound: [] })).toEqual({ self: 'held', partner: 'skipped' });
    sync();
    expect((await getFederationSnapshot(e, A)).federated).toEqual([]);
    expect(await pendingFederationRequests(e, B)).toEqual([]);
  });

  it("a stranger cannot ask on A's behalf", async () => {
    const { A, B, b, e, sync } = await world('22');
    await askFederation(e, A, B, { directions: { inbound: ['library'], outbound: [] } });
    sync();
    expect((await federationRequestRecords(b, B)).size).toBe(0);
  });

  it("B's admin may note where it announced a request; the request stays pending", async () => {
    const { A, B, a, b, sync } = await world('23');
    await setFederationPartner(a, A, B, { inbound: ['library'], outbound: [] });
    sync();
    await markFederationRequestAnnounced(b, B, A, 4242);
    sync();
    const [req] = await pendingFederationRequests(a, B);
    expect(req).toMatchObject({ from: A, messageId: 4242, status: 'pending' });
  });
});

describe('watching every request of the namespace', () => {
  it('hands over each verified envelope with its asked and asking holon', async () => {
    const { A, B, a } = await world('30');
    await setFederationPartner(a, A, B, { inbound: ['library'], outbound: [] });
    const filters: Record<string, unknown>[] = [];
    let feed: (e: NostrEventLike) => void = () => {};
    (a as unknown as { subscribeNostr: unknown }).subscribeNostr = (f: Record<string, unknown>, cb: (e: NostrEventLike) => void) => {
      filters.push(f);
      feed = cb;
      return () => {};
    };
    const seen: Array<{ to: string; from: string }> = [];
    watchAllFederationRequests(a, { appName: APP }, (s) => seen.push({ to: s.to, from: s.from }));
    expect(filters[0]).toMatchObject({ '#l': [FEDERATION_REQUESTS_LENS], '#n': [APP] });
    const events = a.store.exportEvents({ holon: B, lens: FEDERATION_REQUESTS_LENS }) as NostrEventLike[];
    expect(events.length).toBeGreaterThan(0);
    for (const ev of events) feed(ev);
    feed({ ...events[0], sig: '00'.repeat(64) });
    expect(seen).toEqual(events.map(() => ({ to: B, from: A })));
  });
});
