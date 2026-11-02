// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// POST /api/auth/telegram/webapp — log in from a Telegram Mini App launch.
//
// The kiosk opened as a Mini App (`t.me/<bot>/tasks?startapp=<holon>`) posts
// the `initData` Telegram handed it; a bot we hold signed it, so the person is
// who it says without the OIDC round-trip. Same session cookie and same
// derived key as /session returns for a Telegram login.

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  authConfig,
  cookieDomain,
  derivedKeyFor,
  mintSession,
  sessionCookieOptions,
  verifyInitData,
  SESSION_COOKIE,
} from "$lib/server/telegramAuth";
import { botTokens } from "$lib/server/telegramFiles";

export const POST: RequestHandler = async ({ request, cookies, url }) => {
  const cfg = authConfig();
  if (!cfg.jwtSecret) {
    return json(
      { error: "AUTH_JWT_SECRET is not configured" },
      { status: 500 },
    );
  }

  let body: { initData?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const tokens = botTokens();
  if (tokens.length === 0) {
    // Nothing to verify against: every launch would be refused, and the
    // kiosk would read it as "not logged in". Say why, in the response and
    // in the function log.
    console.warn(
      "[kiosk] Mini App launch refused: no BOT_TOKEN/BOT_TOKENS configured",
    );
    return json(
      { error: "No bot token configured to verify Mini App launches" },
      { status: 503 },
    );
  }
  const launch = verifyInitData(String(body.initData ?? ""), tokens);
  if (!launch) {
    // Signed by a bot whose token this deploy does not hold (each Mini App
    // bot — @HubsNetwork_bot on hubs.network — must be in BOT_TOKENS), or
    // older than INIT_DATA_MAX_AGE_S. Logged so the deploy's function log
    // shows it; the kiosk shows the person as signed out.
    console.warn(
      `[kiosk] Mini App launch refused: no configured bot token (${tokens.length}) signed it, or it is stale`,
    );
    return json(
      { error: "Mini App launch not signed by a configured bot, or stale" },
      { status: 401 },
    );
  }

  const token = await mintSession(launch.profile, cfg.jwtSecret);
  cookies.set(
    SESSION_COOKIE,
    token,
    sessionCookieOptions(url.protocol === "https:", cookieDomain(url.hostname)),
  );
  return json({
    user: launch.profile,
    ...derivedKeyFor(launch.profile, cfg.derivationSecret),
  });
};
