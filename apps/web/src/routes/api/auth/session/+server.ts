// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// GET    /api/auth/session — restore the logged-in user from the session cookie.
// DELETE /api/auth/session — log out (clear the cookie).
//
// In non-production builds, GET falls back to minting a session for the
// configured VITE_DEV_TELEGRAM_USER_ID so local dev works without a real
// Telegram-registered domain. This is hard-gated to !import.meta.env.PROD.

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  verifySession,
  buildAuthResult,
  mintSession,
  sessionCookieOptions,
  authConfig,
  SESSION_COOKIE,
  type TelegramProfile,
} from "$lib/server/telegramAuth";

function devProfile(): TelegramProfile | null {
  if (import.meta.env.PROD) return null;
  const id = import.meta.env.VITE_DEV_TELEGRAM_USER_ID;
  const first_name = import.meta.env.VITE_DEV_TELEGRAM_USER_NAME;
  if (!id || !first_name) return null;
  return {
    id: String(id),
    first_name: String(first_name),
    last_name: import.meta.env.VITE_DEV_TELEGRAM_USER_LAST_NAME || undefined,
    username: import.meta.env.VITE_DEV_TELEGRAM_USER_USERNAME || undefined,
  };
}

export const GET: RequestHandler = async ({ cookies, url }) => {
  const cfg = authConfig();

  const profile = await verifySession(
    cookies.get(SESSION_COOKIE),
    cfg.jwtSecret,
  );
  if (profile) {
    return json(buildAuthResult(profile, cfg.derivationSecret));
  }

  // Dev-only auto-login so the dashboard always has an identity locally.
  const dev = devProfile();
  if (dev) {
    const token = await mintSession(dev, cfg.jwtSecret);
    cookies.set(
      SESSION_COOKIE,
      token,
      sessionCookieOptions(url.protocol === "https:"),
    );
    return json(buildAuthResult(dev, cfg.derivationSecret));
  }

  return json({ user: null }, { status: 401 });
};

export const DELETE: RequestHandler = async ({ cookies }) => {
  cookies.delete(SESSION_COOKIE, { path: "/" });
  return json({ ok: true });
};
