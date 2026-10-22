// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The kiosk's side of a task's chat and whiteboard. Meaning lives in
// @holons/core/tasks (chat.ts, board.ts): the canonical task (`taskRef`),
// the `taskchat` lens and its kind-9 projection, the excalidraw room link.
// This module only binds them to the kiosk's HoloSphere and writer.

import { writeAcceptance, type WriteStanding } from "@holons/core/holosphere";
import {
  ensureTaskBoard,
  QUESTS_LENS,
  sendTaskChatMessage,
  taskChatAvailable,
  watchTaskChat,
  type TaskChatMessage,
  type TaskRef,
} from "@holons/core/tasks";
import { getHolosphere, getWriter } from "./holosphere";

export type { TaskChatMessage, TaskRef };

/** Follow a task's chat; the returned function releases the subscription. */
export function watchChat(
  ref: TaskRef,
  onChange: (messages: TaskChatMessage[]) => void,
): () => void {
  let stop: (() => void) | null = null;
  let stopped = false;
  void getHolosphere().then((hs) => {
    if (!stopped) stop = watchTaskChat(hs, ref, onChange);
  });
  return () => {
    stopped = true;
    stop?.();
  };
}

/** Post to a task's chat (throws when the message was not saved). */
export async function sendChat(
  ref: TaskRef,
  text: string,
): Promise<TaskChatMessage> {
  return sendTaskChatMessage(await getHolosphere(), ref, text);
}

/** Can this task have a chat, and would this session's messages count? */
export async function chatAccess(
  ref: TaskRef,
): Promise<{ available: boolean; standing: WriteStanding | null }> {
  const hs = await getHolosphere();
  if (!taskChatAvailable(hs, ref)) return { available: false, standing: null };
  try {
    return { available: true, standing: await writeAcceptance(hs, ref.holon) };
  } catch {
    return { available: true, standing: null };
  }
}

/** The task's whiteboard link, made on first use; null when it could not be saved. */
export async function openBoard(ref: TaskRef): Promise<string | null> {
  const hs = await getHolosphere();
  const writer = await getWriter(ref.holon);
  const res = await ensureTaskBoard(
    {
      get: (key) => hs.get(ref.holon, QUESTS_LENS, key),
      put: (record) => writer.put(QUESTS_LENS, record),
    },
    ref.key,
  );
  return res?.url ?? null;
}

/** One row of the chat log: a day line before the first message of each day. */
export type ChatRow =
  | { kind: "day"; key: string; at: number }
  | {
      kind: "message";
      key: string;
      message: TaskChatMessage;
      mine: boolean;
      first: boolean;
    };

/**
 * Lay out messages (oldest first) for the log: day separators, own messages
 * marked, and `first` on a message that starts a new run by its author.
 */
export function chatRows(
  messages: TaskChatMessage[],
  me: string | null,
): ChatRow[] {
  const rows: ChatRow[] = [];
  let day = "";
  let prevAuthor: string | null | undefined;
  for (const m of messages) {
    const d = new Date(m.at);
    const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (k !== day) {
      day = k;
      prevAuthor = undefined;
      rows.push({ kind: "day", key: `day:${k}`, at: m.at });
    }
    rows.push({
      kind: "message",
      key: m.id,
      message: m,
      mine: !!me && m.author === me,
      first: m.author !== prevAuthor,
    });
    prevAuthor = m.author;
  }
  return rows;
}
