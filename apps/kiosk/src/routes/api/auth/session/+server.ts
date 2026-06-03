// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// GET    /api/auth/session — return the logged-in Telegram profile from the
//                            session cookie (or a dev user in non-prod).
// DELETE /api/auth/session — log out (clear the cookie).

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  authConfig,
  verifySession,
  mintSession,
  sessionCookieOptions,
  cookieDomain,
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

export const GET: RequestHandler = async ({ url, cookies }) => {
  const cfg = authConfig();

  const profile = await verifySession(
    cookies.get(SESSION_COOKIE),
    cfg.jwtSecret,
  );
  if (profile) return json({ user: profile });

  // Dev-only auto-login so editing works locally without a real round-trip.
  const dev = devProfile();
  if (dev) {
    const token = await mintSession(dev, cfg.jwtSecret);
    cookies.set(
      SESSION_COOKIE,
      token,
      sessionCookieOptions(
        url.protocol === "https:",
        cookieDomain(url.hostname),
      ),
    );
    return json({ user: dev });
  }

  return json({ user: null }, { status: 401 });
};

export const DELETE: RequestHandler = async ({ url, cookies }) => {
  const domain = cookieDomain(url.hostname);
  cookies.delete(SESSION_COOKIE, { path: "/", ...(domain ? { domain } : {}) });
  return json({ ok: true });
};
