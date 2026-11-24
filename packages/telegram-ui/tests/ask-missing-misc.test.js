// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Commands sent without their parameters ask for them (src/AskMissing.js)
// instead of answering with a usage line: /get, /compute, /publish (H3),
// /summary (OneOnOne), /test_signal, /reset_signals (SignalDiagnostics),
// /key link (Keys).

import { describe, it, expect, vi, afterEach } from 'vitest';
import shared from '../src/AskMissing.js';
import H3 from '../src/H3.js';
import OneOnOne from '../src/OneOnOne.js';
import Keys from '../src/Keys.js';
import SignalDiagnostics from '../core/SignalDiagnostics.js';

afterEach(() => shared.shutdown());

const CHAT = -100;
const USER = 7;

function harness() {
  const commands = {};
  const bot = {
    command: (names, fn) =>
      [].concat(names).forEach(name => (commands[name] = fn)),
    action: () => {},
    hears: () => {},
    on: () => {},
  };
  let id = 100;
  const telegram = {
    sendMessage: vi.fn(async () => ({ message_id: ++id })),
    deleteMessage: vi.fn(async () => true),
  };
  const ctxFor = (text, extra = {}) => ({
    chat: { id: CHAT, type: 'private' },
    from: { id: USER, username: 'ann' },
    message: {
      message_id: ++id,
      text,
      chat: { id: CHAT, type: 'private' },
      ...extra,
    },
    telegram,
    reply: vi.fn(async () => ({ message_id: ++id })),
  });
  // What the wired middleware does with the initiator's next message.
  const answer = text =>
    shared.middleware(ctxFor(text), async () => 'passed through');
  const asked = () => telegram.sendMessage.mock.calls.at(-1)?.[1];
  return { bot, commands, telegram, ctxFor, answer, asked };
}

describe('H3 commands ask for what is missing', () => {
  const build = () => {
    const h = harness();
    const db = {
      get: vi.fn(async () => ({ ok: 1 })),
      compute: vi.fn(async () => {}),
    };
    const settings = { getSettings: async () => ({ hex: 'hex1' }) };
    new H3(h.bot, db, settings);
    return { ...h, db };
  };

  it('/get asks for the tag, then reads it', async () => {
    const { commands, ctxFor, answer, asked, db, telegram } = build();
    const ctx = ctxFor('/get');
    await commands.get(ctx);
    expect(asked()).toMatch(/Which tag/);
    expect(ctx.reply).not.toHaveBeenCalled();
    await answer('two words');
    expect(db.get).not.toHaveBeenCalled();
    expect(asked()).toMatch(/single tag/);
    await answer('quests');
    expect(db.get).toHaveBeenCalledWith('hex1', 'quests');
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(telegram.deleteMessage).toHaveBeenCalled();
  });

  it('/compute asks for the operation and the lens, or only the lens', async () => {
    const { commands, ctxFor, answer, asked, db } = build();
    await commands.compute(ctxFor('/compute'));
    expect(asked()).toMatch(/sum/);
    await answer('average');
    expect(asked()).toMatch(/Only "sum"/);
    await answer('sum');
    expect(asked()).toMatch(/Which lens/);
    await answer('quests');
    expect(db.compute).toHaveBeenCalledWith('hex1', 'quests', 'sum');

    await commands.compute(ctxFor('/compute sum'));
    expect(asked()).toMatch(/Which lens/);
    await answer('expenses');
    expect(db.compute).toHaveBeenLastCalledWith('hex1', 'expenses', 'sum');

    const other = ctxFor('/compute avg');
    await commands.compute(other);
    expect(other.reply).toHaveBeenCalledWith('Operation not implemented');
  });

  it('/publish still wants a replied-to message, and asks for the tags', async () => {
    const { commands, ctxFor, asked } = build();
    const bare = ctxFor('/publish');
    await commands.publish(bare);
    expect(bare.reply).toHaveBeenCalledWith(
      'Please reply to a message you want to publish.'
    );
    await commands.publish(
      ctxFor('/publish', { reply_to_message: { message_id: 5 } })
    );
    expect(asked()).toMatch(/Which tags/);
  });
});

describe('/summary', () => {
  it('asks for the summary of an ongoing conversation', async () => {
    const { bot, commands, ctxFor, answer, asked } = harness();
    const db = { put: vi.fn(async () => {}) };
    const one = new OneOnOne(bot, db, {});
    const none = ctxFor('/summary');
    await commands.summary(none);
    expect(none.reply).toHaveBeenCalledWith(
      'You have no ongoing conversations to report.'
    );

    one.conversations.ann = { partner: 'bob', holonId: CHAT };
    const ctx = ctxFor('/summary');
    await commands.summary(ctx);
    expect(asked()).toMatch(/summary/);
    expect(db.put).not.toHaveBeenCalled();
    await answer('We talked about bees');
    expect(db.put).toHaveBeenCalledWith(
      String(CHAT),
      'summaries',
      expect.objectContaining({ summary: 'We talked about bees' })
    );
    expect(ctx.reply).toHaveBeenCalledWith('Thank you for your summary!');
  });
});

describe('signal diagnostics', () => {
  const build = () => {
    const h = harness();
    const signalManager = {
      getDiagnostics: () => ({ byModule: { Quests: [], Expenses: [] } }),
      findMatchingPatterns: vi.fn(() => []),
      clearModuleActions: vi.fn(() => 3),
    };
    const diagnostics = new SignalDiagnostics(h.bot, signalManager);
    diagnostics.isAdmin = async () => true;
    return { ...h, signalManager };
  };

  it('/test_signal asks for the callback data', async () => {
    const { commands, ctxFor, answer, asked, signalManager } = build();
    await commands.test_signal(ctxFor('/test_signal'));
    expect(asked()).toMatch(/Which signal/);
    await answer('view_quest_1');
    expect(signalManager.findMatchingPatterns).toHaveBeenCalledWith(
      'view_quest_1'
    );
  });

  it('/reset_signals lists the modules and asks which one', async () => {
    const { commands, ctxFor, answer, asked, signalManager } = build();
    await commands.reset_signals(ctxFor('/reset_signals'));
    expect(asked()).toMatch(/Quests, Expenses/);
    await answer('Quests');
    expect(signalManager.clearModuleActions).toHaveBeenCalledWith('Quests');
  });
});

describe('/key link', () => {
  it('asks for the key when the verb comes alone', async () => {
    const { ctxFor, answer, asked } = harness();
    const keys = new Keys(null, {}, { derivationSecret: 'x'.repeat(32) });
    const start = vi
      .spyOn(keys, 'startLink')
      .mockImplementation(async () => {});
    await keys.command(ctxFor('/key link'));
    expect(asked()).toMatch(/Which public key do you want to link/);
    await answer('nope');
    expect(asked()).toMatch(/doesn't look like a public key/);
    const pk = 'a'.repeat(64);
    await answer(pk);
    expect(start).toHaveBeenCalledWith(expect.anything(), pk);
  });
});
