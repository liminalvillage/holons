// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  isTelegramGroupId,
  isTelegramUserId,
  mayAskQuestRefresh,
  questChats,
  questMessageRefs,
} from './telegram.js';

const L84 = '-1004438000774';
const roberto = { id: 235114395, first_name: 'Roberto' };
const jillian = { id: 1169665422, first_name: 'Jillian' };
const keyed = { id: '8f90b2d7ab8c35a678c86ba49eff927acfa2538af912a82541f2ac03685dbda2' };

describe('Telegram ids', () => {
  it('tells groups from users from everything else', () => {
    expect(isTelegramGroupId(L84)).toBe(true);
    expect(isTelegramGroupId(-5172644935)).toBe(true);
    expect(isTelegramGroupId('235114395')).toBe(false);
    expect(isTelegramUserId(235114395)).toBe(true);
    expect(isTelegramUserId(L84)).toBe(false);
    for (const bad of ['holon_fig33pftaepw96i4', keyed.id, '', null, undefined, '-', '8a2b']) {
      expect(isTelegramGroupId(bad)).toBe(false);
      expect(isTelegramUserId(bad)).toBe(false);
    }
  });
});

describe('questChats', () => {
  it('names the home chat of a Telegram-group holon, nothing for a keyed holon', () => {
    expect(questChats({ holon: L84, quest: { participants: [] } })).toEqual([{ chat: L84, role: 'home' }]);
    expect(questChats({ holon: 'holon_fig33pftaepw96i4', quest: { participants: [] } })).toEqual([]);
  });

  it('adds the chats of whoever joined or left, and of whoever acted', () => {
    const before = { participants: [roberto, keyed] };
    const quest = { participants: [jillian, keyed] };
    expect(questChats({ holon: L84, quest, before })).toEqual([
      { chat: L84, role: 'home' },
      { chat: '1169665422', role: 'person' },
      { chat: '235114395', role: 'person' },
    ]);
    expect(questChats({ holon: L84, quest, touched: [roberto.id, keyed.id, null] })).toEqual([
      { chat: L84, role: 'home' },
      { chat: '235114395', role: 'person' },
    ]);
  });

  it('adds every Telegram message the bot has sent, once each', () => {
    const quest = {
      participants: [roberto],
      activeHolograms: [
        { platform: 'telegram', holonId: '235114395', messageId: 78327 },
        { holonId: -5172644935, messageId: 12 },
        { platform: 'discord', holonId: '999', messageId: 'x' },
        { platform: 'telegram', holonId: L84, messageId: 593 },
        null,
      ],
    };
    expect(questChats({ holon: L84, quest, touched: [roberto.id] })).toEqual([
      { chat: L84, role: 'home' },
      { chat: '235114395', role: 'person' },
      { chat: '-5172644935', role: 'hologram' },
    ]);
    expect(questMessageRefs(quest)).toHaveLength(3);
    expect(questMessageRefs({})).toEqual([]);
  });

  it("a personal holon's own quest has the person's chat as home", () => {
    expect(questChats({ holon: 235114395, quest: { participants: [] }, touched: [235114395] })).toEqual([
      { chat: '235114395', role: 'home' },
    ]);
  });
});

describe('mayAskQuestRefresh', () => {
  it('lets a member ask for their own chat or a group, nothing else', () => {
    expect(mayAskQuestRefresh('235114395', 235114395)).toBe(true);
    expect(mayAskQuestRefresh(L84, 235114395)).toBe(true);
    expect(mayAskQuestRefresh('1169665422', 235114395)).toBe(false);
    expect(mayAskQuestRefresh('holon_x', 235114395)).toBe(false);
    expect(mayAskQuestRefresh('', 235114395)).toBe(false);
  });
});
