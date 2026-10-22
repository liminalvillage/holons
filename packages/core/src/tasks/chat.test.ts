// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { buildEvent } from 'holosphere/nostr-events.js';
import { createHoloSphere } from '../holosphere/factory.js';
import { testKey } from '../protocol/testing.js';
import {
  TASKCHAT_LENS,
  listTaskChat,
  mayPostTaskChat,
  sendTaskChatMessage,
  taskChatAvailable,
  taskChatGroupId,
  taskRef,
  watchTaskChat,
  type TaskChatMessage,
} from './chat.js';

const APP = 'taskchat-test';
const T0 = 1_760_000_000;
const sphere = (sk = testKey().sk) => createHoloSphere({ appName: APP, privateKey: sk, store: { adapter: 'memory' } });
const tick = () => new Promise((r) => setTimeout(r, 0));
const clock = (start: number) => {
  let t = start;
  return () => (t += 1000);
};

describe('taskRef', () => {
  it('own records stay where they are seen', () => {
    expect(taskRef({ id: 'q1', title: 'x' }, '-100', 'q1')).toEqual({ holon: '-100', key: 'q1' });
    expect(taskRef({ id: 734 }, '-100', 734)).toEqual({ holon: '-100', key: '734' });
  });

  it('a hologram and a federated copy point at the source', () => {
    const holo = { _hologram: { isHologram: true, sourceHolon: '-200', sourceKey: 'q9' } };
    expect(taskRef(holo, '-100', 'local-pointer')).toEqual({ holon: '-200', key: 'q9' });
    expect(taskRef({ _federation: { origin: '-300' } }, '-100', 'q1')).toEqual({ holon: '-300', key: 'q1' });
    // Hologram and source share one chat.
    const seen = taskRef(holo, '-100', 'local-pointer');
    expect(taskChatGroupId(seen.holon, seen.key)).toBe(taskChatGroupId('-200', 'q9'));
  });
});

describe('task chat', () => {
  it('sends and lists a task\'s messages, oldest first, and no other task\'s', async () => {
    const me = testKey();
    const hs = sphere(me.sk);
    await hs.ready();
    const ref = { holon: '-100', key: 'q1' };
    const now = clock(1_790_000_000_000);
    const a = await sendTaskChatMessage(hs, ref, '  first  ', { now });
    await sendTaskChatMessage(hs, ref, 'second', { now });
    await sendTaskChatMessage(hs, { holon: '-100', key: 'q2' }, 'elsewhere', { now });
    expect(a).toMatchObject({ task: 'q1', text: 'first', author: me.pk });

    const list = await listTaskChat(hs, ref);
    expect(list.map((m) => m.text)).toEqual(['first', 'second']);
    expect(list[0].author).toBe(me.pk);
    const raw = await hs.get('-100', TASKCHAT_LENS, a.id);
    expect(raw).toMatchObject({ id: a.id, task: 'q1', text: 'first', at: a.at });
  });

  it('refuses empty and oversize messages', async () => {
    const hs = sphere();
    await hs.ready();
    const ref = { holon: '-100', key: 'q1' };
    await expect(sendTaskChatMessage(hs, ref, '   ')).rejects.toThrow(/Empty/);
    await expect(sendTaskChatMessage(hs, ref, 'x'.repeat(4001))).rejects.toThrow(/longer/);
    expect(await listTaskChat(hs, ref)).toEqual([]);
  });

  it('a private task has no chat', async () => {
    const hs = sphere();
    await hs.ready();
    const ref = { holon: '-100', key: 'q1' };
    expect(taskChatAvailable(hs, ref)).toBe(true);
    (hs as any).isPrivate = (holon: string, lens: string, item?: string) => holon === '-100' && lens === 'quests' && item === 'q1';
    expect(taskChatAvailable(hs, ref)).toBe(false);
    await expect(sendTaskChatMessage(hs, ref, 'hi')).rejects.toThrow(/private/);
  });

  it('a message from a key the holon has not seated does not show', async () => {
    const bot = testKey(), member = testKey(), stranger = testKey();
    const hs = sphere(bot.sk);
    await hs.ready();
    await hs.foundHolon('-200', { at: T0 });
    await hs.addMember('-200', member.pk, 'member', { at: T0 + 10 });
    const msg = (sk: Uint8Array, id: string, text: string, at: number) =>
      buildEvent({ holon: '-200', lens: TASKCHAT_LENS, item: { id, task: 'q1', text, at: at * 1000 }, sk, created_at: at, extraTags: [['n', APP]] });
    hs.store.apply(msg(member.sk, 'm1', 'from a member', T0 + 20), { origin: 'remote' });
    hs.store.apply(msg(stranger.sk, 'm2', 'from a stranger', T0 + 21), { origin: 'remote' });
    const list = await listTaskChat(hs, { holon: '-200', key: 'q1' });
    expect(list.map((m) => [m.text, m.author])).toEqual([['from a member', member.pk]]);
  });

  it('watch follows the chat and stops when released', async () => {
    const hs = sphere();
    await hs.ready();
    const ref = { holon: '-100', key: 'q1' };
    const now = clock(1_790_000_000_000);
    await sendTaskChatMessage(hs, ref, 'before', { now });
    const seen: TaskChatMessage[][] = [];
    const stop = watchTaskChat(hs, ref, (m) => seen.push(m));
    await tick();
    await tick();
    expect(seen.at(-1)!.map((m) => m.text)).toEqual(['before']);

    await sendTaskChatMessage(hs, ref, 'after', { now });
    await sendTaskChatMessage(hs, { holon: '-100', key: 'q2' }, 'elsewhere', { now });
    await tick();
    await tick();
    expect(seen.at(-1)!.map((m) => m.text)).toEqual(['before', 'after']);

    stop();
    const count = seen.length;
    await sendTaskChatMessage(hs, ref, 'unseen', { now });
    await tick();
    await tick();
    expect(seen.length).toBe(count);
  });

  it('only a key whose writes count may post', () => {
    expect(mayPostTaskChat(null)).toBe(false);
    expect(mayPostTaskChat({ status: 'held', role: null, anchor: 'x', source: 'log' })).toBe(false);
    expect(mayPostTaskChat({ status: 'open', role: null, anchor: null, source: null })).toBe(true);
    expect(mayPostTaskChat({ status: 'accepted', role: 'member', anchor: 'x', source: 'log' })).toBe(true);
  });
});
