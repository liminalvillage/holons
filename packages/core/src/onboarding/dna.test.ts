// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Onboarding and the DNA: an onboarding links a key only while its request
// carries the holon's DNA as it is now; the gate a board shows; ticking
// one's own card.

import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { createHoloSphere } from '../holosphere/factory.js';
import { signerFromSecretKey } from '../holosphere/signers.js';
import { putGene, readGenes } from '../dna/genes.js';
import { dnaHash } from '../dna/version.js';
import { createHolon, joinRequestRecords, parseJoinRequest, recordJoinRequest } from '../holons/index.js';
import { signJoinRequest } from '../holons/testing.js';
import { holonMembers } from '../protocol/founding.js';
import { testKey } from '../protocol/testing.js';
import {
  CARDS_LENS,
  completeOwnCard,
  joinGate,
  onboardingCardId,
  onboardingView,
  refreshOnboarding,
  saveOnboarding,
  saveProfile,
  startOnboarding,
  type JoinGateInput,
  type OnboardingConfig,
} from './index.js';

const founder = testKey();
const alice = testKey();
const APP = 'onboarding-dna-test';
const signer = (sk: Uint8Array) => signerFromSecretKey(bytesToHex(sk));

function instance(sk = founder.sk) {
  const hs = createHoloSphere({ appName: APP, privateKey: bytesToHex(sk), store: { adapter: 'memory' } });
  const h = hs as unknown as { publishNostrEvents(e: unknown): void; subscribeNostr(): () => void };
  h.publishNostrEvents = () => {};
  h.subscribeNostr = () => () => {};
  return hs;
}

const config: OnboardingConfig = {
  enabled: true,
  steps: [
    { id: 'profile', title: 'Profile', cards: [{ id: 'profile', title: 'Fill in your profile', confirm: 'profile', fields: [{ key: 'first_name', label: 'Name', type: 'text', required: true }] }] },
    { id: 'video', title: 'Video', cards: [{ id: 'video', title: 'Watch the video', confirm: 'self' }] },
  ],
};

async function setup() {
  const hs = instance();
  const { holon } = await createHolon(hs, signer(founder.sk), { appName: APP });
  await saveOnboarding(hs, holon, config);
  await putGene(hs, holon, { kind: 'values', title: 'Values', alleles: [{ title: 'Care' }] });
  const hash = dnaHash(await readGenes(hs, holon))!;
  return { hs, holon, hash };
}

const ask = (hs: ReturnType<typeof instance>, holon: string, dna: string | null, at: number) =>
  parseJoinRequest(signJoinRequest(hs, holon, signer(alice.sk), { appName: APP, reason: 'Alice', dna, now: () => at }))!;

const tick = async (hs: ReturnType<typeof instance>, home: string, id: string) => {
  const card = (await hs.get(home, CARDS_LENS, id)) as Record<string, unknown>;
  await hs.put(home, CARDS_LENS, { ...card, status: 'completed' });
};

describe('an onboarding links only with the current DNA agreed to', () => {
  it('does not link when the DNA changed after every step was done, and links after a fresh request', async () => {
    const { hs, holon, hash } = await setup();
    const home = '4242';
    const opts = { signer: signer(founder.sk), appName: APP };
    const start = await startOnboarding(hs, holon, ask(hs, holon, hash, 1_800_000_000), { ...opts, home });
    expect(start.view).toMatchObject({ dna: 'acknowledged', blocked: null, step: 'profile' });
    expect(start.record.dna).toBe(hash);

    // The admin changes the DNA while Alice walks her steps.
    await putGene(hs, holon, { id: 'values', alleles: [{ title: 'Care' }, { title: 'Courage' }] });
    await saveProfile(hs, home, { first_name: 'Alice' });
    await refreshOnboarding(hs, holon, alice.pk, opts);
    await tick(hs, home, onboardingCardId(holon, 'video', 'video'));
    const held = (await refreshOnboarding(hs, holon, alice.pk, opts))!;
    expect(held.linked).toBe(false);
    expect(held.view).toMatchObject({ finished: true, status: 'pending', dna: 'outdated', blocked: 'dna' });
    expect((await joinRequestRecords(hs, holon)).get(alice.pk)).toMatchObject({ status: 'pending', blocked: 'dna' });
    expect((await holonMembers(hs, holon)).has(alice.pk)).toBe(false);
    // Asking again re-checks, and holds again: nothing changed.
    expect((await refreshOnboarding(hs, holon, alice.pk, opts))!.linked).toBe(false);
    expect((await onboardingView(hs, holon, alice.pk))!.blocked).toBe('dna');

    // She walks the changed DNA and asks again with its hash.
    const now = dnaHash(await readGenes(hs, holon))!;
    await recordJoinRequest(hs, holon, ask(hs, holon, now, 1_800_000_500));
    const done = (await refreshOnboarding(hs, holon, alice.pk, opts))!;
    expect(done.linked).toBe(true);
    expect(done.view).toMatchObject({ status: 'approved', dna: 'acknowledged', blocked: null });
    expect((await holonMembers(hs, holon)).get(alice.pk)).toBe('member');
    await hs.close();
  });

  it('a request that agreed to no DNA is held at the end, a holon without one links as before', async () => {
    const { hs, holon } = await setup();
    const opts = { signer: signer(founder.sk), appName: APP };
    await saveOnboarding(hs, holon, { enabled: true, steps: [config.steps[0]] });
    await saveProfile(hs, '4242', { first_name: 'Alice' });
    const r = await startOnboarding(hs, holon, ask(hs, holon, null, 1_800_000_000), { ...opts, home: '4242' });
    expect(r).toMatchObject({ linked: false, view: { finished: true, dna: 'missing', blocked: 'dna' } });

    const plain = instance();
    const { holon: H2 } = await createHolon(plain, signer(founder.sk), { appName: APP });
    await saveOnboarding(plain, H2, { enabled: true, steps: [config.steps[0]] });
    await saveProfile(plain, '4242', { first_name: 'Alice' });
    const linked = await startOnboarding(plain, H2, ask(plain, H2, null, 1_800_000_000), { ...opts, home: '4242' });
    expect(linked).toMatchObject({ linked: true, view: { dna: 'none-required', blocked: null } });
    await hs.close();
    await plain.close();
  });
});

describe('completeOwnCard', () => {
  it('ticks a dealt card once, and refuses one not dealt', async () => {
    const { hs, holon, hash } = await setup();
    const home = alice.pk;
    const start = await startOnboarding(hs, holon, ask(hs, holon, hash, 1_800_000_000), { appName: APP, home, signer: signer(founder.sk) });
    await saveProfile(hs, home, { first_name: 'Alice' });
    await hs.login(bytesToHex(alice.sk));
    const video = { questId: onboardingCardId(holon, 'video', 'video') };
    await expect(completeOwnCard(hs, start.view, video)).rejects.toThrow(/not dealt/);
    const { dealCards } = await import('./cards.js');
    await dealCards(hs, holon, home, config.steps[1]);
    expect(await completeOwnCard(hs, start.view, video, { now: '2026-11-14T10:00:00.000Z' })).toBe(true);
    expect(await hs.get(home, CARDS_LENS, video.questId)).toMatchObject({ status: 'completed', completed_at: '2026-11-14T10:00:00.000Z' });
    expect(await completeOwnCard(hs, start.view, video)).toBe(false);
    await hs.close();
  });
});

describe('joinGate', () => {
  const key = 'k'.repeat(64);
  const rows: Array<[string, JoinGateInput, string]> = [
    ['/dna, logged out', { explicit: 'dna' }, 'front'],
    ['/dna, linked', { explicit: 'dna', sessionKey: key, standing: 'accepted' }, 'front'],
    ['/apply, logged out', { explicit: 'apply' }, 'apply'],
    ['/apply, linked', { explicit: 'apply', sessionKey: key, standing: 'accepted' }, 'apply'],
    ['/onboarding, logged out', { explicit: 'onboarding' }, 'onboarding'],
    ['/onboarding, linked', { explicit: 'onboarding', sessionKey: key, standing: 'accepted' }, 'board'],
    ['logged out, holon with genes (a wall display)', { front: { genes: true, onboarding: true } }, 'board'],
    ['logged out, held standing', { standing: 'held', front: { genes: true, onboarding: false } }, 'board'],
    ['linked', { sessionKey: key, standing: 'accepted', front: { genes: true, onboarding: true } }, 'board'],
    ['linked, stale pending record', { sessionKey: key, standing: 'accepted', pending: true }, 'board'],
    ['request in', { sessionKey: key, standing: 'held', pending: true, front: { genes: true, onboarding: true } }, 'onboarding'],
    ['not linked, genes', { sessionKey: key, standing: 'held', front: { genes: true, onboarding: false } }, 'front'],
    ['not linked, onboarding on', { sessionKey: key, standing: 'held', front: { genes: false, onboarding: true } }, 'front'],
    ['not linked, nothing to show', { sessionKey: key, standing: 'held', front: { genes: false, onboarding: false } }, 'board'],
    ['not linked, front unknown', { sessionKey: key, standing: 'held' }, 'board'],
  ];
  it.each(rows)('%s', (_name, input, gate) => {
    expect(joinGate(input)).toBe(gate);
  });
});
