// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Onboarding into a holon, answered from Telegram (src/HolonOnboarding.js):
// a request to a holon with an onboarding is walked through its steps — a
// DM per step, Confirm buttons for the admins — and linked at the end.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { bytesToHex } from 'nostr-tools/utils';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { createHoloSphere, signerFromSecretKey } from '@holons/core/holosphere';
import { deriveTelegramNostrKey } from '@holons/core/auth';
import { holonMembers, syncMembersLog } from '@holons/core/protocol';
import { joinRequestRecords } from '@holons/core/holons';
import {
  onboardingCardId,
  saveOnboarding,
  saveProfile,
} from '@holons/core/onboarding';
import JoinRequests from '../src/JoinRequests.js';
import { setProjectionHostForTests } from '../src/createHoloSphere.js';

const key = () => {
  const sk = generateSecretKey();
  return { sk: bytesToHex(sk), pk: getPublicKey(sk) };
};
const B = key(); // the bot: the chat holon's key
const T = '-1009876543210';
const APP = 'onboarding-bot-test';
const SECRET = 'onboarding-test-secret';
const ADA = '4242';

const steps = [
  {
    id: 'profile',
    title: 'Your profile',
    cards: [
      { id: 'profile', title: 'Fill in your profile', confirm: 'profile' },
    ],
  },
  {
    id: 'call',
    title: 'Onboarding call',
    cards: [{ id: 'call', title: 'Have your call', confirm: 'admin' }],
  },
  {
    id: 'arrival',
    title: 'Before you arrive',
    cards: [{ id: 'video', title: 'Watch the video', confirm: 'self' }],
  },
];

let open = [];
afterEach(async () => {
  setProjectionHostForTests(null);
  for (const hs of open) await hs.close();
  open = [];
});

async function setup() {
  const hs = createHoloSphere({
    appName: APP,
    privateKey: B.sk,
    store: { adapter: 'memory' },
  });
  open.push(hs);
  hs.publishNostrEvents = () => {};
  await syncMembersLog(hs, T, new Map());
  await saveOnboarding(hs, T, { enabled: true, steps });
  let messageId = 100;
  const telegram = {
    sendMessage: vi.fn(async () => ({ message_id: ++messageId })),
    getChatMember: vi.fn(async () => ({
      status: 'left',
      user: { id: 4242, first_name: 'Ada' },
    })),
  };
  const service = new JoinRequests(null, hs, null, {
    derivationSecret: SECRET,
    signer: signerFromSecretKey(B.sk),
    isAdmin: async () => true,
  });
  service.bot = { telegram };
  service.onboarding.bot = { telegram, botInfo: { username: 'TestBot' } };
  const sent = () =>
    telegram.sendMessage.mock.calls.map(([chat, text, extra]) => ({
      chat: String(chat),
      text,
      extra,
    }));
  const buttons = m => (m.extra?.reply_markup?.inline_keyboard ?? []).flat();
  const cb = (data, chat, from) => {
    const [action, ...rest] = data.split(':');
    return {
      chat: { id: Number(chat) },
      from,
      match: [data, ...rest],
      answerCbQuery: vi.fn(async () => {}),
      editMessageText: vi.fn(async () => {}),
      action,
    };
  };
  return { hs, telegram, service, sent, buttons, cb };
}

describe('a holon with an onboarding', () => {
  it('walks a Telegram applicant through it and links the key at the end', async () => {
    const { hs, service, sent, buttons, cb } = await setup();
    const ada = deriveTelegramNostrKey(ADA, SECRET);
    const reply = vi.fn(async () => {});
    const start = { from: { id: 4242, first_name: 'Ada' }, reply };

    expect(await service.askFromTelegram(start, T)).toBe('onboarding');
    expect((await joinRequestRecords(hs, T)).get(ada.publicKey)).toMatchObject({
      status: 'pending',
      home: ADA,
      step: 'profile',
    });
    // The group hears of it; Ada gets her first step, not the old Link/Decline.
    const first = sent();
    expect(
      first.some(m => m.chat === T && /started this holon/.test(m.text))
    ).toBe(true);
    expect(
      first.flatMap(buttons).some(b => /^joinok:/.test(b.callback_data ?? ''))
    ).toBe(false);
    expect(first.find(m => m.chat === ADA).text).toMatch(
      /Fill in your profile/
    );

    // Profile filled in (the /onboarding wizard writes the same record) → the sweep moves her on.
    await saveProfile(hs, ADA, { first_name: 'Ada', ikigai: 'bread' });
    await service.onboarding.sweep();
    const ask = sent().find(m => m.chat === T && /An admin ticks/.test(m.text));
    const confirm = buttons(ask)[0].callback_data;
    expect(confirm).toBe(`onbok:${ada.publicKey.slice(0, 16)}:1:0`);
    expect(Buffer.byteLength(confirm)).toBeLessThanOrEqual(64);

    // An admin confirms the call → the last step reaches her DM with a Done button.
    const press = cb(confirm, T, { id: 7, username: 'boss' });
    await service.onboarding.confirm(press);
    expect(press.editMessageText.mock.calls[0][0]).toMatch(/ticked by @boss/);
    const dm = sent()
      .filter(m => m.chat === ADA)
      .at(-1);
    expect(dm.text).toMatch(/Watch the video/);
    const done = buttons(dm).find(b =>
      /^onbdone:/.test(b.callback_data ?? '')
    ).callback_data;
    expect(done).toBe(`onbdone:${T}:2:0`);

    // Someone else pressing her button ticks nothing.
    const stranger = cb(done, '999', { id: 999 });
    await service.onboarding.done(stranger);
    expect((await holonMembers(hs, T)).has(ada.publicKey)).toBe(false);

    await service.onboarding.done(cb(done, ADA, { id: 4242 }));
    expect(
      await hs.get(ADA, 'quests', onboardingCardId(T, 'arrival', 'video'))
    ).toMatchObject({ status: 'completed' });
    expect((await holonMembers(hs, T)).get(ada.publicKey)).toBe('member');
    expect(
      sent()
        .filter(m => m.chat === ADA)
        .at(-1).text
    ).toMatch(/Your key is linked/);
    expect((await joinRequestRecords(hs, T)).get(ada.publicKey)).toMatchObject({
      status: 'approved',
    });

    // Asking again: already in.
    expect(await service.askFromTelegram(start, T)).toBe('seated');
    service.shutdown();
  });

  it('leaves a holon without an onboarding to Link / Decline', async () => {
    const { hs, service, sent, buttons } = await setup();
    await saveOnboarding(hs, T, { enabled: false, steps });
    const reply = vi.fn(async () => {});
    expect(
      await service.askFromTelegram(
        { from: { id: 4242, first_name: 'Ada' }, reply },
        T
      )
    ).toBe('posted');
    expect(
      sent()
        .flatMap(buttons)
        .some(b => /^joinok:/.test(b.callback_data ?? ''))
    ).toBe(true);
    service.shutdown();
  });
});
