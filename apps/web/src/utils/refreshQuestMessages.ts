// SPDX-License-Identifier: AGPL-3.0-or-later
//
// After a quest write, ask the bot to re-render the quest's Telegram messages.
//
// Which chats those are — the holon's own chat, the DM of whoever acted (the
// hologram behind it is core's write, `attachRosterMirror`), every copy the
// bot has sent — is core's rule (`questChats`, @holons/core/tasks), the same
// one the bot and the kiosk use. The web renders nothing: one POST per chat to
// the bot's `/refresh/quest`, best-effort, once the write has landed.

import { questChats, type QuestChatsInput } from "@holons/core/tasks";

const BOT_API_URL = (import.meta.env.VITE_BOT_API_URL || "").replace(/\/$/, "");

export function refreshQuestMessages(
  opts: QuestChatsInput & { questId: string | number },
): void {
  if (!BOT_API_URL) return;
  for (const { chat } of questChats(opts)) {
    fetch(`${BOT_API_URL}/refresh/quest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: chat, questId: String(opts.questId) }),
    }).catch(() => {});
  }
}
