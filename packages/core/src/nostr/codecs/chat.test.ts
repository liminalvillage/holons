// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { PROJECTABLE_LENSES, PROJECTION_CODECS, parseProjectionList } from '../projections.js';
import type { ProjectionCtx } from '../types.js';
import { GROUP_CHAT_KIND, TASKCHAT_LENS, chatCodec, taskChatGroupId } from './chat.js';

const HOLON = '-1003864542239';
const ctx: ProjectionCtx = { appName: 'HolonsTest', holonPubkey: 'a'.repeat(64), now: () => 1_800_000_000 };
const tag = (t: string[][], name: string) => t.find((x) => x[0] === name);

describe('taskChatGroupId', () => {
  it('is a stable NIP-29 id per (holon, task)', () => {
    const id = taskChatGroupId(HOLON, '734');
    expect(id).toMatch(/^t[0-9a-f]{32}$/);
    expect(taskChatGroupId(HOLON, '734')).toBe(id);
    expect(taskChatGroupId(HOLON, '735')).not.toBe(id);
    expect(taskChatGroupId('other', '734')).not.toBe(id);
    // Arbitrary task keys still give a valid id.
    expect(taskChatGroupId(HOLON, 'Sweep the plaza / ☀')).toMatch(/^t[0-9a-f]{32}$/);
  });
});

describe('chat codec', () => {
  it('is registered and on by default', () => {
    expect(PROJECTION_CODECS[TASKCHAT_LENS]).toBe(chatCodec);
    expect(PROJECTABLE_LENSES).toContain(TASKCHAT_LENS);
    expect(parseProjectionList(undefined)).toContain(TASKCHAT_LENS);
  });

  it('projects a message to a kind 9 in the task group', () => {
    const out = chatCodec.project(HOLON, { id: 'm1', task: '734', text: '  see you at 9  ', at: 1_790_000_000_500 }, ctx)!;
    const p = out.primary;
    expect(p.kind).toBe(GROUP_CHAT_KIND);
    expect(p.content).toBe('see you at 9');
    expect(p.created_at).toBe(1_790_000_000);
    expect(tag(p.tags, 'h')).toEqual(['h', taskChatGroupId(HOLON, '734')]);
    expect(tag(p.tags, 'n')).toEqual(['n', 'HolonsTest']);
    expect(tag(p.tags, 'holons')).toEqual(['holons', 'quests', HOLON, '734']);
    expect(out.companions).toBeUndefined();
  });

  it('projects nothing for an empty or unattached message, and retracts nothing', () => {
    expect(chatCodec.project(HOLON, { id: 'm1', task: '734', text: '   ' }, ctx)).toBeNull();
    expect(chatCodec.project(HOLON, { id: 'm1', text: 'hi' }, ctx)).toBeNull();
    expect(chatCodec.project(HOLON, { task: '734', text: 'hi' }, ctx)).toBeNull();
    expect(chatCodec.retract(HOLON, 'm1', ctx)).toEqual([]);
  });

  it('falls back to now without a timestamp', () => {
    expect(chatCodec.project(HOLON, { id: 'm1', task: '734', text: 'hi' }, ctx)!.primary.created_at).toBe(1_800_000_000);
  });
});
