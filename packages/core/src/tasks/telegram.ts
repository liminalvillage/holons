// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Where a quest shows as Telegram messages.
//
// Telegram shows a quest as messages: one in the holon's own chat when the
// holon is a Telegram chat, one DM for each member who holds a hologram of it
// in their personal holon (the roster mirror writes that hologram on the
// write itself, see roster-mirror.ts), one per federated copy. The bot renders
// every one of them and records each message it has sent on the quest
// (`activeHolograms`); after a write they are stale until re-rendered. The
// kiosk and the web render nothing — they ask the bot (`/refresh/quest`, one
// chat per ask). Which chats a write touches is this one rule, so the bot and
// every other surface name the same chats.

import { isTelegramChatId } from '../protocol/founding.js';
import { participantsOf, rosterDiff } from './participants.js';
import type { Quest } from './types.js';

export type QuestChatRole =
  /** The holon's own chat: the quest's main message. */
  | 'home'
  /** A member's own chat: the DM behind the hologram in their personal holon. */
  | 'person'
  /** A copy the bot sent to another group (federation). */
  | 'hologram';

export interface QuestChat {
  /** Telegram chat id — a group's (negative) or a user's (positive). */
  chat: string;
  role: QuestChatRole;
}

/** A message the bot has sent for the quest, as it records it on the quest. */
export interface QuestMessageRef {
  platform?: string;
  holonId: string | number;
  messageId?: string | number;
}

type QuestLike = Pick<Quest, 'participants'> & { activeHolograms?: unknown };

export interface QuestChatsInput {
  /** The quest's home holon. */
  holon: string | number;
  /** The quest as written. */
  quest: QuestLike;
  /** The quest before the write, when known: whoever joined or left gets their DM re-rendered. */
  before?: QuestLike | null;
  /** People whose DM must re-render regardless — the member acting from another chat. */
  touched?: ReadonlyArray<string | number | null | undefined>;
}

/** A Telegram group or supergroup: the chats the bot posts quest messages in. */
export function isTelegramGroupId(id: unknown): boolean {
  const s = String(id ?? '').trim();
  return s.startsWith('-') && isTelegramChatId(s);
}

/** A Telegram user's chat — their personal holon's DM. */
export function isTelegramUserId(id: unknown): boolean {
  const s = String(id ?? '').trim();
  return !s.startsWith('-') && isTelegramChatId(s);
}

/** The Telegram messages the bot has sent for this quest, off `activeHolograms`. */
export function questMessageRefs(quest: { activeHolograms?: unknown } | null | undefined): QuestMessageRef[] {
  const list = Array.isArray(quest?.activeHolograms) ? quest!.activeHolograms : [];
  return list.filter(
    (h): h is QuestMessageRef =>
      !!h &&
      typeof h === 'object' &&
      (h as QuestMessageRef).holonId != null &&
      ((h as QuestMessageRef).platform == null || (h as QuestMessageRef).platform === 'telegram')
  );
}

/**
 * Every Telegram chat whose message of this quest a write leaves stale, in
 * render order: the home chat (when the holon is a Telegram chat), the chats
 * of the people whose place on the roster changed or who acted, then every
 * copy already sent. Deduplicated; ids that are no Telegram chat are left out.
 */
export function questChats({ holon, quest, before, touched = [] }: QuestChatsInput): QuestChat[] {
  const out: QuestChat[] = [];
  const seen = new Set<string>();
  const add = (chat: unknown, role: QuestChatRole) => {
    const c = String(chat ?? '').trim();
    if (!c || seen.has(c) || !isTelegramChatId(c)) return;
    seen.add(c);
    out.push({ chat: c, role });
  };
  add(holon, 'home');
  if (before) {
    const { joined, left } = rosterDiff(participantsOf(before), participantsOf(quest));
    for (const p of [...joined, ...left]) if (isTelegramUserId(p?.id)) add(p.id, 'person');
  }
  for (const id of touched) if (isTelegramUserId(id)) add(id, 'person');
  for (const ref of questMessageRefs(quest)) add(ref.holonId, isTelegramUserId(ref.holonId) ? 'person' : 'hologram');
  return out;
}

/**
 * May this member ask the bot to re-render a quest in this chat? Their own
 * chat, or a group — the bot only renders a quest that already exists in
 * that holon, so a group ask shows nothing the member could not have written.
 */
export function mayAskQuestRefresh(chat: unknown, requester: unknown): boolean {
  const c = String(chat ?? '').trim();
  if (!c) return false;
  return c === String(requester ?? '').trim() || isTelegramGroupId(c);
}
