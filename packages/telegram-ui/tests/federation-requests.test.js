// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Federation requests reach the Telegram group (src/FederationRequests.js):
// a partner that linked to a chat the bot speaks for is announced once, only
// the chat's admins can Accept / Decline, and the bot's own link commands ask
// the partner's admins unless the person is an admin there too
// (src/federationLinks.js).

import { readdirSync, readFileSync } from 'node:fs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { bytesToHex } from 'nostr-tools/utils';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { createHoloSphere } from '@holons/core/holosphere';
import {
  getFederationSnapshot,
  pendingFederationRequests,
  setFederationPartner,
} from '@holons/core/federation';
import FederationRequests from '../src/FederationRequests.js';
import {
  linkHolons,
  outcomeText,
  shouldAskPartner,
} from '../src/federationLinks.js';

const key = () => {
  const sk = generateSecretKey();
  return { sk: bytesToHex(sk), pk: getPublicKey(sk) };
};
const APP = 'fed-bot-test';
const T0 = 1_700_000_000;
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
  for (const hs of open) await hs.close();
  open = [];
});

const sphere = sk => {
  const hs = createHoloSphere({
    appName: APP,
    privateKey: sk,
    store: { adapter: 'memory' },
  });
  hs.publishNostrEvents = () => {};
  open.push(hs);
  return hs;
};

/** Copy every event between the instances — a relay they all share. */
function share(...spheres) {
  const events = spheres.flatMap(s => s.store.exportEvents());
  for (const s of spheres) {
    for (const e of events)
      s.store.apply(e, { origin: 'remote', verify: false });
    s._readAuthority?.invalidate();
  }
}

/**
 * Two Telegram groups the bot set up; Alice is an admin of A only. Alice
 * links A ↔ B from her side, so B is asked.
 */
async function world() {
  const bot = key(),
    alice = key();
  const A = '-1001111111111',
    B = '-1002222222222';
  const o = sphere(bot.sk),
    a = sphere(alice.sk);
  await Promise.all([o.ready(), a.ready()]);
  await o.foundHolon(A, { at: T0 });
  await o.foundHolon(B, { at: T0 });
  await o.addMember(A, alice.pk, 'admin', { at: T0 + 1 });
  share(o, a);
  const out = await setFederationPartner(a, A, B, {
    inbound: ['library'],
    outbound: [],
    holonName: 'Lunation',
  });
  expect(out).toEqual({ self: 'linked', partner: 'requested' });
  share(o, a);

  let messageId = 500;
  const telegram = {
    sendMessage: vi.fn(async () => ({ message_id: ++messageId })),
  };
  const service = (hs = o, admin = true) => {
    const s = new FederationRequests(null, hs, null, {
      isAdmin: async () => admin,
    });
    s.bot = { telegram };
    return s;
  };
  const press = (from, chat = B) => ({
    chat: { id: Number(chat), type: 'supergroup' },
    from: { id: 7, username: 'boss' },
    match: [null, from],
    answerCbQuery: vi.fn(async () => {}),
    editMessageText: vi.fn(async () => {}),
  });
  return { A, B, o, a, telegram, service, press };
}

describe('a federation request for a Telegram group', () => {
  it('is posted once, with buttons for the admins, and not again after a restart', async () => {
    const { A, B, o, telegram, service } = await world();
    expect(await service().announce(B)).toBe(1);
    const [chat, text, extra] = telegram.sendMessage.mock.calls[0];
    expect(chat).toBe(B);
    expect(text).toContain('<b>Lunation</b> asks to federate');
    expect(text).toContain('would send: library');
    const buttons = extra.reply_markup.inline_keyboard.flat();
    expect(buttons.map(b => b.callback_data)).toEqual([
      `fedok:${A}`,
      `fedno:${A}`,
    ]);
    expect(buttons.every(b => Buffer.byteLength(b.callback_data) <= 64)).toBe(
      true
    );
    const [req] = await pendingFederationRequests(o, B);
    expect(req.messageId).toBe(501);
    // A replay in this process, or a fresh process: nothing new.
    expect(await service().announce(B)).toBe(0);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('is not posted by a bot that does not speak for the group', async () => {
    const { B, a, telegram, service } = await world();
    expect(await service(a).announce(B)).toBe(0);
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('collapses a burst of sightings into one announcement per group', async () => {
    const { B, service } = await world();
    const s = service();
    s.settleMs = 0;
    const announce = vi.spyOn(s, 'announce').mockResolvedValue(1);
    s.onSighting({ to: B, from: 'x', eventId: 'e1' });
    s.onSighting({ to: B, from: 'x', eventId: 'e2' });
    s.onSighting({ to: B, from: 'x', eventId: 'e1' });
    s.onSighting({ to: '4242', from: 'x', eventId: 'e3' });
    await until(() => announce.mock.calls.length > 0);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(B);
    s.shutdown();
  });
});

describe('Accept / Decline in the group', () => {
  it('refuses anyone who is not an admin of the chat', async () => {
    const { A, B, o, service, press } = await world();
    await service().announce(B);
    const ctx = press(A);
    await service(o, false).decide(ctx, 'accept');
    expect(ctx.answerCbQuery.mock.calls[0][0]).toMatch(/admins/i);
    expect(ctx.editMessageText).not.toHaveBeenCalled();
    expect((await getFederationSnapshot(o, B)).federated).not.toContain(A);
  });

  it("accepting writes the group's own half and closes the request", async () => {
    const { A, B, o, service, press } = await world();
    await service().announce(B);
    const ctx = press(A);
    await service().decide(ctx, 'accept');
    expect(ctx.editMessageText.mock.calls[0][0]).toMatch(
      /Federated with <b>Lunation<\/b> — accepted by @boss/
    );
    expect((await getFederationSnapshot(o, B)).lensConfig[A]).toEqual({
      inbound: [],
      outbound: ['library'],
    });
    expect(await pendingFederationRequests(o, B)).toEqual([]);
    const again = press(A);
    await service().decide(again, 'accept');
    expect(again.answerCbQuery.mock.calls[0][0]).toMatch(/no longer open/);
  });

  it('declining leaves the group alone', async () => {
    const { A, B, o, service, press } = await world();
    const ctx = press(A);
    await service().decide(ctx, 'decline');
    expect(ctx.editMessageText.mock.calls[0][0]).toMatch(/Declined/);
    expect((await getFederationSnapshot(o, B)).federated).not.toContain(A);
    expect(await pendingFederationRequests(o, B)).toEqual([]);
  });
});

describe('who decides for the partner', () => {
  it('asks the partner unless the person administers the partner chat', async () => {
    const telegram = {
      getChatMember: vi.fn(async (chat, user) => ({
        status:
          user === 1 ? 'administrator' : user === 2 ? 'creator' : 'member',
      })),
    };
    expect(await shouldAskPartner(telegram, '-100123', 1)).toBe(false);
    expect(await shouldAskPartner(telegram, '-100123', 2)).toBe(false);
    expect(await shouldAskPartner(telegram, '-100123', 3)).toBe(true);
    expect(await shouldAskPartner(telegram, 'holon_abc', 1)).toBe(true);
    expect(await shouldAskPartner(telegram, '-100123', undefined)).toBe(true);
    const failing = {
      getChatMember: vi.fn(async () => {
        throw new Error('400');
      }),
    };
    expect(await shouldAskPartner(failing, '-100123', 1)).toBe(true);
  });

  it('the bot asks by default even though its key speaks for both groups', async () => {
    const { A, B, o } = await world();
    const asked = await linkHolons(o, A, B, {
      lensConfig: { inbound: ['quests'], outbound: [] },
    });
    expect(asked).toMatchObject({
      success: true,
      outcome: { partner: 'requested' },
    });
    const direct = await linkHolons(o, A, B, {
      lensConfig: { inbound: ['quests'], outbound: [] },
      askPartner: false,
    });
    expect(direct.outcome).toEqual({ self: 'linked', partner: 'linked' });
    expect((await getFederationSnapshot(o, B)).lensConfig[A]).toEqual({
      inbound: [],
      outbound: ['quests'],
    });
  });

  it('says what happened on the other side', () => {
    expect(
      outcomeText({ self: 'linked', partner: 'requested' }, 'Liminal')
    ).toMatch(/Asked Liminal's admins/);
    expect(
      outcomeText({ self: 'removed', partner: 'requested' }, 'Liminal')
    ).toMatch(/remove it on their side/);
    expect(
      outcomeText({ self: 'held', partner: 'skipped' }, 'Liminal')
    ).toMatch(/not an admin/);
    expect(
      outcomeText({ self: 'linked', partner: 'linked' }, 'Liminal')
    ).toMatch(/both sides/);
    expect(
      outcomeText({ self: 'linked', partner: 'unchanged' }, 'Liminal')
    ).toBeNull();
  });
});

describe('the Accept / Decline buttons reach this service', () => {
  // Telegraf runs the first matching bot.action; an unanchored pattern
  // elsewhere (the calendar's `n_…` once matched "holo**n_**z6s…") swallowed
  // the press and nothing happened.
  const actionPatterns = () => {
    const dir = new URL('../src/', import.meta.url);
    const out = [];
    for (const file of readdirSync(dir)) {
      if (!/\.(js|ts)$/.test(file) || file === 'FederationRequests.js')
        continue;
      const src = readFileSync(new URL(file, dir), 'utf8');
      for (const m of src.matchAll(
        /\.action\(\s*\/((?:\\\/|[^/\n])+)\/([a-z]*)/g
      )) {
        out.push({ file, re: new RegExp(m[1], m[2]) });
      }
    }
    return out;
  };

  it('no other handler matches a press for a keyed or Telegram holon', () => {
    const presses = ['holon_z6sdwna7ahqeps29', '-1004438000774'].flatMap(id => [
      `fedok:${id}`,
      `fedno:${id}`,
    ]);
    const patterns = actionPatterns();
    expect(patterns.length).toBeGreaterThan(20);
    const clashes = patterns.flatMap(({ file, re }) =>
      presses.filter(p => re.test(p)).map(p => `${file} ${re} ← ${p}`)
    );
    expect(clashes).toEqual([]);
  });
});
