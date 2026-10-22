// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// `taskchat` → NIP-29 kind-9 chat messages. Each task has its own group,
// `taskChatGroupId(holon, task)`; membership is the home holon's, so no
// per-task group state (39000–39002) is published. Kind 9 is a regular
// event signed by whoever writes the message (the browser's transport key
// is the writer's own). Messages are immutable, and a kind 9 has no `d` to
// retract by, so nothing is emitted on delete. Outbound only: a message
// written by a foreign NIP-29 client has no record to fold into.

import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha256';
import type { LensCodec, ProjectionCtx } from '../types.js';
import { CLIENT_TAG_VALUE, HOLONS_ORIGIN_TAG, nowOf } from '../tags.js';

export const GROUP_CHAT_KIND = 9;
export const TASKCHAT_LENS = 'taskchat';

/** One message of a task's chat, as stored in the home holon's `taskchat` lens. */
export interface TaskChatRecord {
  id?: string | number;
  /** Key of the task (in the same holon) the message belongs to. */
  task?: string;
  text?: string;
  /** Unix ms. */
  at?: number;
  /** Writer's pubkey, as the sender stated it. */
  author?: string;
  [key: string]: unknown;
}

/**
 * NIP-29 group id of a task's chat. Group ids are `a-z0-9-_` and task keys
 * are arbitrary, so the canonical (holon, task) pair is hashed; a hologram
 * and its source give the same id.
 */
export function taskChatGroupId(holon: string, task: string): string {
  const digest = sha256(utf8ToBytes(`holons:task-chat:v1|${holon}|${task}`));
  return 't' + bytesToHex(digest).slice(0, 32);
}

export const chatCodec: LensCodec<TaskChatRecord> = {
  lens: TASKCHAT_LENS,
  kinds: [GROUP_CHAT_KIND],
  project(holon: string, item: TaskChatRecord, ctx: ProjectionCtx) {
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    const task = typeof item.task === 'string' ? item.task : '';
    if (item.id === undefined || item.id === null || !text || !task) return null;
    const at = typeof item.at === 'number' && Number.isFinite(item.at) ? Math.floor(item.at / 1000) : nowOf(ctx);
    return {
      primary: {
        kind: GROUP_CHAT_KIND,
        created_at: at,
        tags: [
          ['h', taskChatGroupId(holon, task)],
          ['n', ctx.appName],
          [HOLONS_ORIGIN_TAG, 'quests', holon, task],
          ['client', CLIENT_TAG_VALUE],
        ],
        content: text,
      },
    };
  },
  retract() {
    return [];
  },
};
