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

  const launch = verifyInitData(String(body.initData ?? ""), botTokens());
  if (!launch) {
    return json({ error: "Invalid Mini App launch" }, { status: 401 });
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
