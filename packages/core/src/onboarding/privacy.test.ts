// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// A private holon, end to end over a relay, one instance per person:
//   • a newcomer walks its onboarding and, once seated, reads its locked lens;
//   • a partner holon it shares the lens with reads it too — every member;
//   • a hologram in the partner pointing at a locked card resolves for the
//     partner's members, and for nobody else;
//   • federating alone hands out no key: the partner's federated board
//     shows the private holon's cards only once the lens is shared.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
// @ts-expect-error — the spike relay is plain JS without types.
import { startRelay } from '../../../holosphere/spike/mini-relay.js';
import { createHoloSphere } from '../holosphere/factory.js';
import { writeAcceptance } from '../holosphere/authority.js';
import { signerFromSecretKey } from '../holosphere/signers.js';
import { setFederationPartner } from '../federation/index.js';
import { approveJoin, createHolon, parseJoinRequest, requestToJoin } from '../holons/index.js';
import { lock, share } from '../privacy/audience.js';
import { testKey } from '../protocol/testing.js';
import { readOnboarding, refreshOnboarding, saveOnboarding, saveProfile, startOnboarding } from './index.js';

const APP = 'onboarding-privacy-test';
const signer = (sk: Uint8Array) => signerFromSecretKey(bytesToHex(sk));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function eventually<T>(fn: () => Promise<T>, timeout = 12000): Promise<T> {
  const until = Date.now() + timeout;
  for (;;) {
    const v = await fn().catch(() => undefined as T);
    if (v || Date.now() > until) return v;
    await wait(150);
  }
}

let relay: { url: string; close(): Promise<void> };
const open: ReturnType<typeof createHoloSphere>[] = [];
beforeAll(async () => {
  relay = await startRelay();
});
afterAll(async () => {
  for (const hs of open) await hs.close().catch(() => {});
  await relay.close();
});

async function person(sk: Uint8Array) {
  const hs = createHoloSphere({
    appName: APP,
    privateKey: bytesToHex(sk),
    relays: [relay.url],
    nostr: { syncTimeoutMs: 1500 },
    store: { adapter: 'memory' },
  });
  open.push(hs);
  await hs.ready();
  return hs;
}

/**
 * This instance has synced the holon — its public library card arrived —
 * so whatever of the locked lens it lacks, it lacks for want of a key.
 * (A sealed record a key does not open never even lands in the store.)
 */
const synced = async (hs: ReturnType<typeof createHoloSphere>, holon: string) => ((await hs.getAll(holon, 'library')) as { name?: string }[]).some((x) => x?.name === 'public book');
const federated = async (hs: ReturnType<typeof createHoloSphere>, holon: string) => ((await hs.getFederated(holon, 'quests')) as { title?: string }[]).map((q) => q?.title).filter(Boolean);

const titles = async (hs: ReturnType<typeof createHoloSphere>, holon: string, lens = 'quests') => ((await hs.getAll(holon, lens)) as { title?: string }[]).map((q) => q?.title).filter(Boolean);

describe('a private holon', () => {
  const founder = testKey();
  const alice = testKey();
  const partnerAdmin = testKey();
  const bob = testKey();
  const carol = testKey();

  it('onboarding seats a newcomer, who then reads its locked lens; a federated partner reads it once shared, holograms included', async () => {
    // ── The private holon: a locked quests lens, an onboarding switched on.
    const f = await person(founder.sk);
    const { holon: H } = await createHolon(f, signer(founder.sk), {
      appName: APP,
    });
    await f.put(H, 'quests', {
      id: 'q1',
      title: 'secret plan',
      status: 'ongoing',
      participants: [],
    });
    // No hologram points here: only federation can bring it to the partner's board.
    await f.put(H, 'quests', {
      id: 'q2',
      title: 'second secret',
      status: 'ongoing',
      participants: [],
    });
    await lock(f, { holon: H, lens: 'quests' });
    await f.put(H, 'library', { id: 'b1', name: 'public book' });
    await saveOnboarding(f, H, {
      enabled: true,
      steps: [
        {
          id: 'profile',
          title: 'Profile',
          cards: [{ id: 'profile', title: 'Your profile', confirm: 'profile' }],
        },
      ],
    });

    // ── Alice, not seated: what the kiosk gate reads — held, onboarding on — and no plaintext.
    const a = await person(alice.sk);
    expect(await eventually(async () => (await readOnboarding(a, H)).enabled)).toBe(true);
    expect((await writeAcceptance(a, H)).status).toBe('held');
    expect(await eventually(() => synced(a, H))).toBe(true);
    expect(await titles(a, H)).not.toContain('secret plan');

    // She asks; the founder (answering for the holon) starts her onboarding.
    const request = parseJoinRequest(requestToJoin(a, H, signer(alice.sk), { appName: APP, reason: 'Alice' }))!;
    const opts = { signer: signer(founder.sk), appName: APP };
    const started = await startOnboarding(f, H, request, {
      ...opts,
      home: alice.pk,
    });
    expect(started.view.step).toBe('profile');

    // She fills her profile in her own holon; the founder reads it from the relay and links her.
    await saveProfile(a, alice.pk, { first_name: 'Alice', ikigai: 'bread' });
    const linked = await eventually(async () => (await refreshOnboarding(f, H, alice.pk, opts))?.view.status === 'approved');
    expect(linked).toBe(true);

    // Seated: her key counts, and the roster sync handed her the lens key.
    expect(await eventually(async () => (await writeAcceptance(a, H)).status === 'accepted')).toBe(true);
    expect(await eventually(async () => (await titles(a, H)).includes('secret plan'))).toBe(true);

    // ── A partner holon: its admin seats Bob. Carol is nobody's member.
    const g = await person(partnerAdmin.sk);
    const { holon: P } = await createHolon(g, signer(partnerAdmin.sk), {
      appName: APP,
    });
    await approveJoin(g, P, bob.pk, signer(partnerAdmin.sk), { appName: APP });
    const b = await person(bob.sk);
    const c = await person(carol.sk);

    // A hologram in the partner pointing at the locked card.
    await g.put(P, 'quests', g.createHologram(H, 'quests', { id: 'q1' }));

    // The two holons federate: H sends its quests, P takes them in.
    await setFederationPartner(f, H, P, {
      inbound: [],
      outbound: ['quests', 'library'],
    });
    await setFederationPartner(g, P, H, {
      inbound: ['quests', 'library'],
      outbound: [],
    });
    // The link is live for Bob: H's public book is on P's federated shelf.
    const shelf = async () => ((await b.getFederated(P, 'library')) as { name?: string }[]).some((x) => x?.name === 'public book');
    expect(await eventually(shelf)).toBe(true);

    // Federated, not shared: Bob has synced the holon and reads nothing of the lens —
    // directly, through the hologram, or on P's federated board.
    expect(await eventually(() => synced(b, H))).toBe(true);
    expect(await titles(b, H)).not.toContain('secret plan');
    expect(await titles(b, P)).not.toContain('secret plan');
    expect(await federated(b, P)).not.toContain('secret plan');
    expect(await federated(b, P)).not.toContain('second secret');

    // The private holon shares its lens with the partner HOLON: every reader of it gets the key.
    const shared = await share(f, { holon: H, lens: 'quests' }, P);
    expect(shared.holons.find((h) => h.holon === P)).toMatchObject({
      kind: 'group',
    });
    expect(shared.holons.find((h) => h.holon === P)!.readers).toBeGreaterThanOrEqual(2);

    expect(await eventually(async () => (await titles(b, H)).includes('secret plan'))).toBe(true);
    expect(await eventually(async () => (await titles(b, P)).includes('secret plan'))).toBe(true);
    expect(await eventually(async () => (await federated(b, P)).includes('second secret'))).toBe(true);
    // ...and the plain view of P is still only P's own: the hologram, not the federated card.
    expect(await titles(b, P)).not.toContain('second secret');

    // Carol holds no key: the lens, the hologram and the federated board stay closed to her.
    expect(await eventually(() => synced(c, H))).toBe(true);
    expect(await titles(c, H)).not.toContain('secret plan');
    expect(await titles(c, P)).not.toContain('secret plan');
    expect(await federated(c, P)).not.toContain('secret plan');
    expect(await federated(c, P)).not.toContain('second secret');
  }, 60000);
});
