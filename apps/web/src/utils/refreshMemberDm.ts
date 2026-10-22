// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Keep a member's linked Telegram DM in sync after they left a quest.
//
// The hologram in the member's personal holon is core's doing: every roster
// write mirrors itself into each person's holon and drops the mirror of
// whoever was taken off (`attachRosterMirror`, @holons/core/tasks). What is
// left for the web is delivery on a LEAVE — the mirror is dropped with a
// delete, which nothing reacts to, so the bot is asked to refresh the DM.
//
// Call it once the roster write has landed. Best-effort: a failure here must
// never surface as a failed leave.

const BOT_API_URL = (import.meta.env.VITE_BOT_API_URL || "").replace(/\/$/, "");

export function refreshMemberDm(opts: {
  questId: string;
  userId: string | number;
  joined: boolean;
}): void {
  if (opts.joined || !BOT_API_URL) return;
  fetch(`${BOT_API_URL}/refresh/quest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chatId: String(opts.userId),
      questId: String(opts.questId),
    }),
  }).catch(() => {});
}
