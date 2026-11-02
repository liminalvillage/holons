// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// POST /api/quest/refresh — same-origin proxy that asks the Telegram bot to
// create/refresh a quest message in a chat.
//
// Why a proxy: the bot's /refresh/quest endpoint only allows CORS from the web
// dashboard origin, so the kiosk (served from *.hubs.network and other hosts)
// can't call it from the browser. This server route is same-origin for the
// kiosk, verifies the caller's session, and forwards server→server to the bot.
//
// Two uses: (1) after a join/leave, to refresh the member's personal-holon
// DM — core's roster write leaves a {id,soul} hologram in (memberId,'quests',
// questId), then the kiosk POSTs here with chatId == the member's id so the
// bot sends/edits the linked DM; (2) after any kiosk write of a quest on a
// Telegram-group holon, with chatId == the group, so the bot posts the card in
// the chat (the bot has no live subscription on quests — without this ask a
// task born in the kiosk never shows up in Telegram). The rule for which chat
// a session may name is core's `mayAskQuestRefresh` (@holons/core/tasks).

import { json, error } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import type { RequestHandler } from "./$types";
import {
  authConfig,
  verifySession,
  SESSION_COOKIE,
} from "$lib/server/telegramAuth";
import { mayAskQuestRefresh } from "@holons/core/tasks";

/** Bot HTTP base — server-only; defaults to the production bot host. */
function botApiUrl(): string {
  return (
    env.BOT_API_URL ||
    env.VITE_BOT_API_URL ||
    "https://telegram.holons.io"
  ).replace(/\/$/, "");
}

export const POST: RequestHandler = async ({ request, cookies }) => {
  const profile = await verifySession(
    cookies.get(SESSION_COOKIE),
    authConfig().jwtSecret,
  );
  if (!profile) throw error(401, "Not authenticated");

  let body: { chatId?: unknown; questId?: unknown };
  try {
    body = await request.json();
  } catch {
    throw error(400, "Invalid JSON body");
  }
  const chatId = body.chatId == null ? "" : String(body.chatId);
  const questId = body.questId == null ? "" : String(body.questId);
  if (!chatId || !questId) throw error(400, "chatId and questId required");

  // A logged-in user may only refresh their OWN personal-holon DM — guard the
  // open kiosk from being used to spam arbitrary Telegram chats.
  if (!mayAskQuestRefresh(chatId, profile.id))
    throw error(403, "chatId must be your own chat or a Telegram group");

  // Best-effort: the DM is a convenience side-effect, never block the caller on
  // a slow/unreachable bot. Swallow failures and report scheduled regardless.
  try {
    await fetch(`${botApiUrl()}/refresh/quest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, questId }),
    });
  } catch (err) {
    console.warn("[kiosk] quest refresh proxy failed", err);
  }

  return json({ scheduled: true }, { status: 202 });
};
