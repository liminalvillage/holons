// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sealed answers, end to end over a local relay (never a production one):
// a newcomer answers a holon's own questions; the holon's admin reads them
// and moves the onboarding on; a stranger reads nothing, and the public
// profile holds only the shared fields.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
// @ts-expect-error — the spike relay is plain JS without types.
import { startRelay } from '../../../holosphere/spike/mini-relay.js';
import type { HoloSphere } from 'holosphere';
import { createHoloSphere } from '../holosphere/factory.js';
import { signerFromSecretKey } from '../holosphere/signers.js';
import { createHolon, parseJoinRequest } from '../holons/index.js';
import { signJoinRequest } from '../holons/testing.js';
import { testKey } from '../protocol/testing.js';
import {
  ANSWERS_LENS,
  AnswersNotSealedError,
  holonAdminKeys,
  readAnswers,
  readOnboardingAnswers,
  readProfile,
  refreshOnboarding,
  saveAnswers,
  saveOnboarding,
  saveOnboardingAnswers,
  startOnboarding,
  type ProfileField,
} from './index.js';

const APP = 'onboarding-answers-test';
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
  const hs = createHoloSphere({ appName: APP, privateKey: bytesToHex(sk), relays: [relay.url], nostr: { syncTimeoutMs: 1500 }, store: { adapter: 'memory' } });
  open.push(hs);
  await hs.ready();
  return hs;
}

const fields: ProfileField[] = [
  { key: 'first_name', label: 'Name', type: 'text', required: true },
  { key: 'wellbeing', label: 'Anything we should know about your wellbeing?', type: 'longtext', required: true },
  {
    key: 'visit',
    label: 'Would you like to visit?',
    type: 'choice',
    required: true,
    options: [
      { value: 'visit', label: 'Yes' },
      { value: 'remote', label: 'Remotely' },
    ],
  },
];

describe('sealed answers to a holon’s own questions', () => {
  const founder = testKey();
  const alice = testKey();
  const carol = testKey();

  it('the person and the holon’s admins read them; a stranger and the public profile do not', async () => {
    const f = await person(founder.sk);
    const { holon: H } = await createHolon(f, signer(founder.sk), { appName: APP });
    await saveOnboarding(f, H, { enabled: true, steps: [{ id: 'profile', title: 'Profile', cards: [{ id: 'profile', title: 'Your profile', confirm: 'profile', fields }] }] });
    expect(await holonAdminKeys(f, H)).toEqual([founder.pk]);

    const a = await person(alice.sk);
    const request = parseJoinRequest(signJoinRequest(a, H, signer(alice.sk), { appName: APP, reason: 'Alice' }))!;
    const opts = { signer: signer(founder.sk), appName: APP };
    expect((await startOnboarding(f, H, request, { ...opts, home: alice.pk })).view.steps[0].cards[0].missing).toEqual(['first_name', 'wellbeing', 'visit']);

    // Alice answers on her own screen: the name on her profile, the rest sealed.
    await eventually(async () => (await holonAdminKeys(a, H)).includes(founder.pk));
    const merged = await saveOnboardingAnswers(a, alice.pk, H, fields, { first_name: 'Alice', wellbeing: 'a sore knee', visit: 'remote' });
    expect(merged).toMatchObject({ first_name: 'Alice', wellbeing: 'a sore knee', visit: 'remote' });
    const profile = await readProfile(a, alice.pk);
    expect(profile).toMatchObject({ first_name: 'Alice' });
    expect(profile).not.toHaveProperty('wellbeing');
    expect(profile).not.toHaveProperty('visit');
    expect((await readAnswers(a, alice.pk, H))?.answers).toEqual({ wellbeing: 'a sore knee', visit: 'remote' });
    // Nothing in the clear on the wire: the stored envelope does not carry the answer.
    const raw = JSON.stringify((a as unknown as { store: { getEvents(h: string, l: string, id: string): unknown[] } }).store.getEvents(alice.pk, ANSWERS_LENS, H));
    expect(raw).not.toContain('sore knee');

    // The admin reads them and the profile card is done: the onboarding links her.
    expect(await eventually(async () => (await readAnswers(f, alice.pk, H))?.answers.wellbeing === 'a sore knee')).toBe(true);
    expect((await readOnboardingAnswers(f, alice.pk, H))).toMatchObject({ first_name: 'Alice', visit: 'remote' });
    expect(await eventually(async () => (await refreshOnboarding(f, H, alice.pk, opts))?.view.status === 'approved')).toBe(true);

    // A stranger syncs her profile, never her answers.
    const c = await person(carol.sk);
    expect(await eventually(async () => (await readProfile(c, alice.pk))?.first_name === 'Alice')).toBe(true);
    await wait(500);
    expect(await readAnswers(c, alice.pk, H)).toBeNull();
    expect(await readOnboardingAnswers(c, alice.pk, H)).not.toHaveProperty('wellbeing');
  }, 60_000);

  it('refuses to write when the record cannot be sealed', async () => {
    const put = vi.fn();
    const hs = { privacy: undefined, put, getAll: async () => [], get: async () => null } as unknown as HoloSphere;
    await expect(saveAnswers(hs, alice.pk, '-1001', { wellbeing: 'x' })).rejects.toBeInstanceOf(AnswersNotSealedError);
    await expect(saveOnboardingAnswers(hs, alice.pk, '-1001', fields, { first_name: 'A', wellbeing: 'x' })).rejects.toBeInstanceOf(AnswersNotSealedError);
    expect(put).not.toHaveBeenCalled();
  });
});
