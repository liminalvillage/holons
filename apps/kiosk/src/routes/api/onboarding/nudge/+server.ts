// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// POST /api/onboarding/nudge — same-origin proxy that tells the Telegram bot
// someone's onboarding may have moved (a card ticked, a profile saved).
//
// The bot re-reads the person's holon before it acts, so the nudge carries
// no authority: it needs no session (a key login has none), only a holon
// and a key. Proxied for the same reason as /api/quest/refresh — the bot
// only allows CORS from the dashboard's origin.

import { json, error } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import type { RequestHandler } from "./$types";

/** Bot HTTP base — server-only; defaults to the production bot host. */
function botApiUrl(): string {
  return (
    env.BOT_API_URL ||
    env.VITE_BOT_API_URL ||
    "https://telegram.holons.io"
  ).replace(/\/$/, "");
}

export const POST: RequestHandler = async ({ request }) => {
  let body: { holon?: unknown; pubkey?: unknown };
  try {
    body = await request.json();
  } catch {
    throw error(400, "Invalid JSON body");
  }
  const holon = body.holon == null ? "" : String(body.holon);
  const pubkey = body.pubkey == null ? "" : String(body.pubkey).toLowerCase();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(holon) || !/^[0-9a-f]{64}$/.test(pubkey))
    throw error(400, "holon and pubkey (64 hex) required");

  // Best-effort: the bot's sweep catches what a lost nudge misses.
  try {
    await fetch(`${botApiUrl()}/notify/onboarding`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ holon, pubkey }),
    });
  } catch (err) {
    console.warn("[kiosk] onboarding nudge proxy failed", err);
  }
  return json({ scheduled: true }, { status: 202 });
};
