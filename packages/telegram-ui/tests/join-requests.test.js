// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Join requests reach the Telegram group (src/JoinRequests.js): a proven
// group member is linked at once, anyone else is announced for the chat's
// admins — once — and an approved key stays seated through the roster sync.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { bytesToHex } from 'nostr-tools/utils';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { createHoloSphere, signerFromSecretKey } from '@holons/core/holosphere';
import { deriveTelegramNostrKey } from '@holons/core/auth';
import {
  addHolonMember,
  holonMembers,
  syncMembersLog,
} from '@holons/core/protocol';
import {
  approvedJoinKeys,
  joinRequestRecords,
  parseJoinRequest,
  requestToJoin,
} from '@holons/core/holons';
import JoinRequests from '../src/JoinRequests.js';
import {
  createTrustCache,
  setProjectionHostForTests,
} from '../src/createHoloSphere.js';

const key = () => {
  const sk = generateSecretKey();
  return { sk: bytesToHex(sk), pk: getPublicKey(sk) };
};
const B = key(); // the bot: the chat holon's key
const A = key(); // a person on their own Nostr key
const C = key();
const T = '-1009876543210';
const APP = 'join-bot-test';
const SECRET = 'join-test-secret';
const until = async (check, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await check()) return true;
    await new Promise(r => setTimeout(r, 25));
  }
  return check();
};

let open = [];
afterEach(async () => {
  setProjectionHostForTests(null);
  for (const hs of open) await hs.close();
  open = [];
});

/** The bot's instance with the chat founded, and a service over a fake Telegram. */
async function setup({ chatMember, admin = true } = {}) {
  const hs = createHoloSphere({
    appName: APP,
    privateKey: B.sk,
    store: { adapter: 'memory' },
  });
  open.push(hs);
  hs.publishNostrEvents = () => {};
  // The bot founds a chat's member log the way its roster sync does.
  await syncMembersLog(hs, T, new Map());
  let messageId = 100;
  const telegram = {
    sendMessage: vi.fn(async () => ({ message_id: ++messageId })),
    getChatMember: vi.fn(async (...args) => {
      if (!chatMember) throw new Error('user not found');
      return chatMember(...args);
    }),
  };
  const service = new JoinRequests(null, hs, null, {
    derivationSecret: SECRET,
    signer: signerFromSecretKey(B.sk),
    isAdmin: async () => admin,
  });
  service.bot = { telegram };
  const ask = (sk, opts = {}) =>
    parseJoinRequest(
      requestToJoin(hs, T, signerFromSecretKey(sk), { appName: APP, ...opts })
    );
  const press = (pubkey, from = { id: 7, username: 'boss' }) => ({
    chat: { id: Number(T), type: 'supergroup' },
    from,
    match: [null, pubkey.slice(0, 32)],
    answerCbQuery: vi.fn(async () => {}),
    editMessageText: vi.fn(async () => {}),
  });
  return { hs, telegram, service, ask, press };
}

describe('a join request for a Telegram group', () => {
  it('from an own Nostr key is posted once, with buttons for the admins', async () => {
    const { hs, telegram, service, ask } = await setup();
    const req = ask(A.sk, { reason: 'Alice <b>' });
    expect(await service.handle(req)).toBe('posted');
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    const [chat, text, extra] = telegram.sendMessage.mock.calls[0];
    expect(chat).toBe(T);
    expect(text).toContain('<b>Alice &lt;b&gt;</b>');
    expect(text).toMatch(/own Nostr key: <code>npub1/);
    const buttons = extra.reply_markup.inline_keyboard.flat();
    expect(buttons.map(b => b.callback_data)).toEqual([
      `joinok:${A.pk.slice(0, 32)}`,
      `joinno:${A.pk.slice(0, 32)}`,
    ]);
    expect(buttons.every(b => Buffer.byteLength(b.callback_data) <= 64)).toBe(
      true
    );
    expect((await joinRequestRecords(hs, T)).get(A.pk)).toMatchObject({
      status: 'pending',
      messageId: 101,
      eventId: req.eventId,
    });
    // A replay, or a second ask while the first is open: nothing new.
    expect(await service.handle(req)).toBe('known');
    expect(await service.handle(ask(A.sk, { reason: 'Alice' }))).toBe('known');
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('only listens for Telegram groups and answers each event once', async () => {
    const { service, ask } = await setup();
    service.settleMs = 0;
    const handle = vi.spyOn(service, 'handle').mockResolvedValue('posted');
    const req = ask(A.sk);
    service.onRequest(req);
    service.onRequest(req);
    service.onRequest({
      ...req,
      eventId: 'f'.repeat(64),
      holon: 'holon_aaaaaaaaaaaaaaaa',
    });
    service.onRequest({ ...req, eventId: 'e'.repeat(64), holon: '4242' });
    await until(() => handle.mock.calls.length > 0);
    expect(handle).toHaveBeenCalledTimes(1);
    service.shutdown();
  });

  it('links a proven Telegram member of the group without asking anyone', async () => {
    const ada = deriveTelegramNostrKey('4242', SECRET);
    const { hs, telegram, service, ask } = await setup({
      chatMember: async () => ({
        status: 'member',
        user: { id: 4242, first_name: 'Ada', username: 'ada' },
      }),
    });
    const req = ask(ada.privateKey, { reason: 'Ada', telegramId: 4242 });
    expect(await service.handle(req)).toBe('linked');
    expect(telegram.getChatMember).toHaveBeenCalledWith(T, 4242);
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect((await holonMembers(hs, T)).get(ada.publicKey)).toBe('member');
    expect(await hs.get(T, 'users', '4242')).toMatchObject({
      id: 4242,
      first_name: 'Ada',
      username: 'ada',
    });
    expect(await service.handle(req)).toBe('seated');
  });

  it('asks the admins about a proven Telegram user who is not in the group', async () => {
    const ada = deriveTelegramNostrKey('4242', SECRET);
    const { hs, telegram, service, ask } = await setup({
      chatMember: async () => ({
        status: 'left',
        user: { id: 4242, first_name: 'Ada', username: 'ada' },
      }),
    });
    expect(
      await service.handle(ask(ada.privateKey, { telegramId: 4242 }))
    ).toBe('posted');
    const text = telegram.sendMessage.mock.calls[0][1];
    expect(text).toContain('<b>Ada</b> (@ada)');
    expect(text).toMatch(/not in this group/);
    expect((await holonMembers(hs, T)).has(ada.publicKey)).toBe(false);
  });

  it('treats a Telegram claim the key does not prove as a plain key', async () => {
    const { hs, telegram, service, ask } = await setup({
      chatMember: async () => ({ status: 'member', user: { id: 4242 } }),
    });
    expect(
      await service.handle(ask(A.sk, { reason: 'Mallory', telegramId: 4242 }))
    ).toBe('posted');
    expect(telegram.getChatMember).not.toHaveBeenCalled();
    expect(telegram.sendMessage.mock.calls[0][1]).toMatch(/own Nostr key/);
    expect((await holonMembers(hs, T)).has(A.pk)).toBe(false);
  });
});

describe('Approve / Decline in the group', () => {
  it('refuses anyone who is not an admin of the chat', async () => {
    const { hs, service, ask, press } = await setup({ admin: false });
    await service.handle(ask(A.sk, { reason: 'Alice' }));
    const ctx = press(A.pk);
    await service.decide(ctx, 'approved');
    expect(ctx.answerCbQuery.mock.calls[0][0]).toMatch(/admins/i);
    expect(ctx.editMessageText).not.toHaveBeenCalled();
    expect((await holonMembers(hs, T)).has(A.pk)).toBe(false);
  });

  it('an approved key is seated and stays seated through the roster sync', async () => {
    const { hs, service, ask, press } = await setup();
    await service.handle(ask(A.sk, { reason: 'Alice' }));
    const ctx = press(A.pk);
    await service.decide(ctx, 'approved');
    expect((await holonMembers(hs, T)).get(A.pk)).toBe('member');
    expect(await approvedJoinKeys(hs, T)).toEqual([A.pk]);
    expect(ctx.editMessageText.mock.calls[0][0]).toMatch(
      /<b>Alice<\/b> is linked.*@boss/
    );
    // Pressed again: closed.
    const again = press(A.pk);
    await service.decide(again, 'approved');
    expect(again.answerCbQuery.mock.calls[0][0]).toMatch(/no longer open/);

    // The roster sync prunes what the bot seated and the roster does not
    // name (C) — and must leave the approved key alone.
    await addHolonMember(hs, T, C.pk, 'member');
    await hs.put(T, 'users', { id: 1, first_name: 'Bea' });
    setProjectionHostForTests(hs);
    const trust = createTrustCache(B.pk, SECRET, 0);
    expect(await trust.trustedAuthors(T)).toEqual(
      expect.arrayContaining([B.pk, A.pk])
    );
    expect(
      await until(async () => !(await holonMembers(hs, T)).has(C.pk))
    ).toBe(true);
    const bea = deriveTelegramNostrKey(1, SECRET).publicKey;
    const members = await holonMembers(hs, T);
    expect(members.get(A.pk)).toBe('member');
    expect(members.get(bea)).toBe('member');
    // The joiner's seeded record (id = their key) derives nobody.
    expect(await hs.get(T, 'users', A.pk)).toMatchObject({
      first_name: 'Alice',
    });
    expect(members.size).toBe(3);
  });

  it('a declined request is settled and not posted again that day', async () => {
    const { hs, telegram, service, ask, press } = await setup();
    await service.handle(ask(A.sk, { reason: 'Alice' }));
    const ctx = press(A.pk);
    await service.decide(ctx, 'declined');
    expect((await joinRequestRecords(hs, T)).get(A.pk)).toMatchObject({
      status: 'declined',
      by: '7',
    });
    expect((await holonMembers(hs, T)).has(A.pk)).toBe(false);
    expect(ctx.editMessageText.mock.calls[0][0]).toMatch(/declined by @boss/);
    const later = ask(A.sk, {
      reason: 'Alice',
      now: () => Math.floor(Date.now() / 1000) + 5,
    });
    expect(await service.handle(later)).toBe('limited');
    service.now = () => Math.floor(Date.now() / 1000) + 2 * 86400;
    expect(await service.handle(later)).toBe('posted');
    expect(telegram.sendMessage).toHaveBeenCalledTimes(2);
  });
});
