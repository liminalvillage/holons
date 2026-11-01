// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { createHoloSphere } from '../holosphere/factory.js';
import { signerFromSecretKey } from '../holosphere/signers.js';
import { createHolon, joinRequestRecords, parseJoinRequest, requestToJoin } from '../holons/index.js';
import { holonMembers } from '../protocol/founding.js';
import { testKey } from '../protocol/testing.js';
import {
  CARDS_LENS,
  DEFAULT_ONBOARDING_STEPS,
  advance,
  cardKey,
  confirmCard,
  listOnboarding,
  normalizeOnboarding,
  onboardingCardId,
  onboardingHome,
  onboardingView,
  DEFAULT_PROFILE_FIELDS,
  fieldAccepts,
  fieldText,
  fieldValue,
  missingProfileFields,
  normalizeProfileFields,
  profileComplete,
  readOnboarding,
  refreshOnboarding,
  saveOnboarding,
  saveProfile,
  startOnboarding,
  dealCards,
  type OnboardingConfig,
} from './index.js';

const founder = testKey();
const alice = testKey();
const bob = testKey();
const APP = 'holons-test';
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
    {
      id: 'profile',
      title: 'Profile',
      cards: [{ id: 'profile', title: 'Fill in your profile', confirm: 'profile', fields: DEFAULT_PROFILE_FIELDS.map((f) => ({ ...f })) }],
    },
    { id: 'call', title: 'Call', cards: [{ id: 'call', title: 'Onboarding call', confirm: 'admin' }] },
    {
      id: 'arrival',
      title: 'Arrival',
      cards: [
        { id: 'dates', title: 'Dates', confirm: 'self' },
        { id: 'video', title: 'Video', confirm: 'self' },
      ],
    },
  ],
};
const none = { completed: new Set<string>(), profile: null };
const ready = { id: 'x', first_name: 'Ada', ikigai: 'bread' };

describe('the onboarding config', () => {
  it('falls back to the default steps, switched off', () => {
    const c = normalizeOnboarding(undefined);
    expect(c.enabled).toBe(false);
    expect(c.steps.map((s) => s.id)).toEqual(DEFAULT_ONBOARDING_STEPS.map((s) => s.id));
  });

  it('makes ids safe and unique, drops untitled cards and empty steps, defaults confirm to self', () => {
    const c = normalizeOnboarding({
      enabled: true,
      steps: [
        { title: 'Say Hi!', cards: [{ title: 'Wave' }, { title: 'Wave', confirm: 'nonsense' }, { title: '  ' }] },
        { id: 'empty', title: 'Nothing', cards: [] },
      ],
    });
    expect(c).toEqual({
      enabled: true,
      steps: [{ id: 'say_hi', title: 'Say Hi!', cards: [{ id: 'wave', title: 'Wave', confirm: 'self' }, { id: 'wave_2', title: 'Wave', confirm: 'self' }] }],
    });
  });
});

describe('profile fields', () => {
  it('the default asks a name and what they bring', () => {
    expect(profileComplete(null, DEFAULT_PROFILE_FIELDS)).toBe(false);
    expect(profileComplete({ id: 'x', first_name: 'Ada' }, DEFAULT_PROFILE_FIELDS)).toBe(false);
    expect(profileComplete(ready, DEFAULT_PROFILE_FIELDS)).toBe(true);
  });

  it('a holon asks what it needs; only required fields hold the card back', () => {
    const fields = normalizeProfileFields([
      { key: 'arrival' },
      { key: 'departure', required: false },
      { key: 'Diet!', label: 'Anything you do not eat?', type: 'longtext' },
    ]);
    expect(fields).toEqual([
      { key: 'arrival', label: 'Arrival date', type: 'date', required: true },
      { key: 'departure', label: 'Departure date', type: 'date', required: false },
      { key: 'diet', label: 'Anything you do not eat?', type: 'longtext', required: true },
    ]);
    expect(missingProfileFields({ id: 'x', arrival: '2026-11-03' }, fields).map((f) => f.key)).toEqual(['diet']);
    expect(profileComplete({ id: 'x', arrival: '2026-11-03', diet: 'none' }, fields)).toBe(true);
  });

  it('drops unnamed custom fields, reserved and repeated keys; nothing left → the defaults', () => {
    expect(normalizeProfileFields([{ key: 'custom_x' }, { key: 'id', label: 'Id' }]).map((f) => f.key)).toEqual(['first_name', 'ikigai']);
    expect(normalizeProfileFields([{ key: 'values' }, { key: 'values', label: 'Again' }])).toEqual([
      { key: 'values', label: 'Your values', type: 'list', required: true },
    ]);
  });

  it('takes a typed answer by the field type', () => {
    const date = { key: 'arrival', label: 'Arrival', type: 'date', required: true } as const;
    const url = { key: 'linkedin', label: 'Link', type: 'url', required: false } as const;
    const list = { key: 'values', label: 'Values', type: 'list', required: true } as const;
    expect([fieldAccepts(date, '2026-11-03'), fieldAccepts(date, '2026-02-30'), fieldAccepts(date, 'soon')]).toEqual([true, false, false]);
    expect([fieldAccepts(url, 'https://ada.example'), fieldAccepts(url, 'ada')]).toEqual([true, false]);
    expect(fieldAccepts(list, '  ')).toBe(false);
    expect(fieldValue(list, 'care, bread ,, music')).toEqual(['care', 'bread', 'music']);
    expect(fieldText(list, ['care', 'bread'])).toBe('care, bread');
  });

  it('a profile card without fields gets the defaults; other cards carry none', () => {
    const c = normalizeOnboarding({ steps: [{ title: 'S', cards: [{ title: 'P', confirm: 'profile' }, { title: 'Q', fields: [{ key: 'arrival' }] }] }] });
    expect(c.steps[0].cards[0].fields).toEqual(DEFAULT_PROFILE_FIELDS);
    expect(c.steps[0].cards[1].fields).toBeUndefined();
  });
});

describe('advance', () => {
  it('stays on a step until every card of it is done', () => {
    expect(advance(config, { step: 'profile' }, none)).toMatchObject({ step: 'profile', passed: [], finished: false, changed: false });
  });

  it('moves past every step already done', () => {
    const at = advance(config, { step: 'profile', confirmed: [cardKey('call', 'call')] }, { ...none, profile: ready });
    expect(at).toMatchObject({ step: 'arrival', passed: ['profile', 'call'], changed: true });
  });

  it('an admin card listens to admins only: the person ticking it does not count', () => {
    const at = advance(config, { step: 'call' }, { completed: new Set([cardKey('call', 'call')]), profile: ready });
    expect(at.step).toBe('call');
  });

  it('finishes once the last step is done', () => {
    const at = advance(
      config,
      { step: 'arrival', confirmed: [cardKey('call', 'call')] },
      { completed: new Set([cardKey('arrival', 'dates'), cardKey('arrival', 'video')]), profile: ready },
    );
    expect(at).toMatchObject({ step: null, finished: true, passed: ['arrival'] });
  });

  it('a step the config lost puts them back at the first open step', () => {
    expect(advance(config, { step: 'gone' }, { ...none, profile: ready }).step).toBe('call');
  });
});

describe('onboardingHome', () => {
  it('is the proven Telegram id, else the key', () => {
    expect(onboardingHome({ pubkey: alice.pk }, '4242')).toBe('4242');
    expect(onboardingHome({ pubkey: alice.pk.toUpperCase() }, null)).toBe(alice.pk);
  });
});

async function setup() {
  const hs = instance();
  const { holon } = await createHolon(hs, signer(founder.sk), { appName: APP });
  await saveOnboarding(hs, holon, config);
  const request = parseJoinRequest(requestToJoin(hs, holon, signer(alice.sk), { appName: APP, reason: 'Alice' }))!;
  return { hs, holon, request };
}

const complete = async (hs: ReturnType<typeof instance>, home: string, id: string) => {
  const card = (await hs.get(home, CARDS_LENS, id)) as Record<string, unknown>;
  await hs.put(home, CARDS_LENS, { ...card, status: 'completed' });
};

describe('onboarding into a holon', () => {
  it('reads back what an admin saved', async () => {
    const { hs, holon } = await setup();
    expect(await readOnboarding(hs, holon)).toEqual(config);
    await hs.close();
  });

  it('walks a Telegram applicant from profile to linked key', async () => {
    const { hs, holon, request } = await setup();
    const home = '4242';
    const opts = { signer: signer(founder.sk), appName: APP };

    const start = await startOnboarding(hs, holon, request, { ...opts, home });
    expect(start.view).toMatchObject({ step: 'profile', home, name: 'Alice', status: 'pending' });
    expect(start.view.steps[0].cards[0].missing).toEqual(['first_name', 'ikigai']);
    expect(start.dealt).toEqual([onboardingCardId(holon, 'profile', 'profile')]);
    const dealt = (await hs.get(home, CARDS_LENS, start.dealt[0])) as Record<string, any>;
    expect(dealt).toMatchObject({ title: 'Fill in your profile', participants: [{ id: 4242 }], onboarding: { holon, step: 'profile' } });
    expect((await listOnboarding(hs, holon)).map((v) => v.pubkey)).toEqual([alice.pk]);

    // Dealing again writes nothing.
    expect((await refreshOnboarding(hs, holon, alice.pk, opts))!.dealt).toEqual([]);

    await saveProfile(hs, home, { first_name: 'Alice', ikigai: 'bread and music' });
    const afterProfile = (await refreshOnboarding(hs, holon, alice.pk, opts))!;
    expect(afterProfile).toMatchObject({ passed: ['profile'], dealt: [onboardingCardId(holon, 'call', 'call')] });
    expect(afterProfile.view.step).toBe('call');

    // Ticking the admin card herself moves nothing.
    await complete(hs, home, onboardingCardId(holon, 'call', 'call'));
    expect((await refreshOnboarding(hs, holon, alice.pk, opts))!.view.step).toBe('call');
    // A self card is not something an admin vouches for.
    expect(await confirmCard(hs, holon, alice.pk, 'arrival', 'dates', opts)).toBeNull();

    const afterCall = (await confirmCard(hs, holon, alice.pk, 'call', 'call', opts))!;
    expect(afterCall.view.step).toBe('arrival');
    expect(afterCall.dealt).toHaveLength(2);
    expect((await holonMembers(hs, holon)).has(alice.pk)).toBe(false);

    await complete(hs, home, onboardingCardId(holon, 'arrival', 'dates'));
    await complete(hs, home, onboardingCardId(holon, 'arrival', 'video'));
    const done = (await refreshOnboarding(hs, holon, alice.pk, opts))!;
    expect(done).toMatchObject({ linked: true, passed: ['arrival'] });
    expect(done.view).toMatchObject({ finished: true, status: 'approved' });
    expect((await holonMembers(hs, holon)).get(alice.pk)).toBe('member');
    expect((await joinRequestRecords(hs, holon)).get(alice.pk)).toMatchObject({ status: 'approved', by: 'onboarding' });
    expect(await listOnboarding(hs, holon)).toEqual([]);
    await hs.close();
  });

  it('without a signer a finished onboarding waits to be linked', async () => {
    const { hs, holon, request } = await setup();
    await saveOnboarding(hs, holon, { enabled: true, steps: [config.steps[0]] });
    await saveProfile(hs, '4242', { first_name: 'Alice', ikigai: 'bread' });
    const r = await startOnboarding(hs, holon, request, { home: '4242', appName: APP });
    expect(r).toMatchObject({ linked: false, view: { finished: true, status: 'pending' } });
    expect((await holonMembers(hs, holon)).has(alice.pk)).toBe(false);
    await hs.close();
  });

  it("a key's own holon only takes that key: the holon cannot deal there, and a stranger's tick is no tick", async () => {
    const { hs, holon, request } = await setup();
    const opts = { signer: signer(founder.sk), appName: APP };
    await saveOnboarding(hs, holon, { enabled: true, steps: [config.steps[2]] });
    const home = onboardingHome(request);

    const start = await startOnboarding(hs, holon, request, { ...opts, home });
    expect(start.dealt).toEqual([]);

    // Alice deals and ticks on her own screen.
    await hs.login(bytesToHex(alice.sk));
    const step = (await readOnboarding(hs, holon)).steps[0];
    expect(await dealCards(hs, holon, home, step)).toHaveLength(2);
    await complete(hs, home, onboardingCardId(holon, 'arrival', 'dates'));

    // Bob ticks her other card for her.
    await hs.login(bytesToHex(bob.sk));
    await complete(hs, home, onboardingCardId(holon, 'arrival', 'video'));

    await hs.login(bytesToHex(founder.sk));
    const view = (await onboardingView(hs, holon, alice.pk))!;
    expect(view.steps[0].cards.map((c) => [c.id, c.done])).toEqual([
      ['dates', true],
      ['video', false],
    ]);
    expect((await refreshOnboarding(hs, holon, alice.pk, opts))!.linked).toBe(false);
    await hs.close();
  });
});
