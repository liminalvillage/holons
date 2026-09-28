// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The bot's leg of linking a Telegram chat to a dashboard holon
// (@holons/core/linking): who may tap the link, and how the trust cache
// keeps the linked admin seated and bridges the chat's members across.

import { describe, it, expect, vi } from 'vitest';
import { bytesToHex } from 'nostr-tools/utils';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { createHoloSphere } from '@holons/core/holosphere';
import { deriveTelegramNostrKey } from '@holons/core/auth';
import { foundHolon, holonMembers } from '@holons/core/protocol';
import {
  acceptTelegramLink,
  completeTelegramLink,
  offerTelegramLink,
  readLinkAccept,
} from '@holons/core/linking';
import Settings from '../src/Settings.ts';
import {
  createTrustCache,
  setProjectionHostForTests,
} from '../src/createHoloSphere.js';

const key = () => {
  const sk = generateSecretKey();
  return { sk: bytesToHex(sk), pk: getPublicKey(sk) };
};
const P = key();
const B = key();
const T = '-1001234567890';
const SECRET = 'link-test-secret';
const until = async (check, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await check()) return true;
    await new Promise(r => setTimeout(r, 25));
  }
  return check();
};

describe('/start link_… (Settings._acceptHolonLink)', () => {
  const ctxFor = (
    status,
    chat = { id: T, type: 'supergroup', title: 'Orto chat' }
  ) => ({
    chat,
    from: { id: 7 },
    telegram: { getChatMember: vi.fn(async () => ({ status })) },
    reply: vi.fn(async () => ({})),
  });
  const self = db => ({ db, _isChatAdmin: Settings.prototype._isChatAdmin });

  it('refuses a tap from someone who does not admin the chat', async () => {
    const accept = vi.fn();
    const ctx = ctxFor('member');
    await Settings.prototype._acceptHolonLink.call(
      self({ get: accept, put: accept }),
      ctx,
      { holon: 'holon_aaaaaaaaaaaaaaaa', token: 'ABCDEFGHIJKLMNOPQRSTUV' },
      'en',
      T
    );
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx.reply.mock.calls[0][0]).toMatch(/admin/i);
    expect(accept).not.toHaveBeenCalled();
  });

  it('tells the admin when nothing was offered', async () => {
    const hs = createHoloSphere({
      appName: 'link-bot-test',
      privateKey: B.sk,
      store: { adapter: 'memory' },
    });
    const ctx = ctxFor('administrator');
    await Settings.prototype._acceptHolonLink.call(
      self(hs),
      ctx,
      { holon: 'holon_aaaaaaaaaaaaaaaa', token: 'ABCDEFGHIJKLMNOPQRSTUV' },
      'en',
      T
    );
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx.reply.mock.calls[0][0]).toMatch(/no open link offer/i);
    await hs.close();
  });
});

describe('createTrustCache with a linked dashboard holon', () => {
  it('keeps the linked admin seated through a prune and bridges the members', async () => {
    const hs = createHoloSphere({
      appName: 'link-bot-test',
      privateKey: P.sk,
      store: { adapter: 'memory' },
    });
    const D = 'holon_bridgetest0001';
    await foundHolon(hs, D, { name: 'Orto' });
    const { token, id } = await offerTelegramLink(hs, D);

    // The bot accepts (this is what /start link_… does).
    await hs.login(B.sk);
    await hs.put(T, 'users', { id: 1, first_name: 'Alice' });
    const r = await acceptTelegramLink(hs, {
      holon: D,
      token,
      chat: { id: T, type: 'supergroup', title: 'Orto chat' },
      byUserId: 7,
    });
    expect(r.ok).toBe(true);
    expect((await holonMembers(hs, T)).get(P.pk)).toBe('admin');

    // The trust cache refreshes the chat: the users roster is known, so a
    // prune runs — and must leave the linked admin in place.
    setProjectionHostForTests(hs);
    const trust = createTrustCache(B.pk, SECRET, 0);
    const alice = deriveTelegramNostrKey(1, SECRET).publicKey;
    expect(await trust.trustedAuthors(T)).toEqual(
      expect.arrayContaining([B.pk, alice, P.pk])
    );
    expect(
      await until(
        async () => (await holonMembers(hs, T)).get(alice) === 'member'
      )
    ).toBe(true);
    expect((await holonMembers(hs, T)).get(P.pk)).toBe('admin');
    // Not yet seated as admin of D: nothing bridged.
    expect((await holonMembers(hs, D)).has(alice)).toBe(false);

    // The screen confirms: the bot key becomes an admin of D…
    await hs.login(P.sk);
    const accept = await readLinkAccept(hs, { holon: D, id, chat: T });
    await completeTelegramLink(hs, {
      holon: D,
      id,
      chat: T,
      anchor: accept.anchor,
      name: 'Orto chat',
    });
    // …and the next refresh brings the chat's members into D, adding only.
    await hs.login(B.sk);
    await trust.trustedAuthors(T);
    expect(
      await until(
        async () => (await holonMembers(hs, D)).get(alice) === 'member'
      )
    ).toBe(true);
    const d = await holonMembers(hs, D);
    expect(d.get(P.pk)).toBe('admin');
    expect(d.get(B.pk)).toBe('admin');
    setProjectionHostForTests(null);
    await hs.close();
  });
});
