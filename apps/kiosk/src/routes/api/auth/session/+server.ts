// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// GET    /api/auth/session — return the logged-in identity from the session
//                            cookie (or a dev user in non-prod): a Telegram
//                            profile, or a bare key user (pubkey + provider).
// DELETE /api/auth/session — log out (clear the cookie).

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  authConfig,
  verifySessionIdentity,
  mintSession,
  mintKeySession,
  sessionCookieOptions,
  cookieDomain,
  SESSION_COOKIE,
  type TelegramProfile,
} from "$lib/server/telegramAuth";

// Logging out in dev used to be a no-op you couldn't see: DELETE cleared the
// cookie, and the very next session read handed back a freshly minted dev user,
// so a reload silently signed you back in and the logged-out state was
// untestable locally. DELETE now leaves this marker, and the auto-login stands
// down while it is set; a real login (the OIDC callback) clears it.
const DEV_LOGOUT_COOKIE = "kiosk_dev_logout";

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

  const identity = await verifySessionIdentity(
    cookies.get(SESSION_COOKIE),
    cfg.jwtSecret,
  );
  if (identity) {
    // Sliding session: re-mint on every restore so active users never hit the
    // fixed JWT expiry — only SESSION_TTL_S of complete absence logs you out.
    const token =
      identity.kind === "telegram"
        ? await mintSession(identity.profile, cfg.jwtSecret)
        : await mintKeySession(identity, cfg.jwtSecret);
    cookies.set(
      SESSION_COOKIE,
      token,
      sessionCookieOptions(
        url.protocol === "https:",
        cookieDomain(url.hostname),
      ),
    );
    return json(
      identity.kind === "telegram"
        ? { user: identity.profile }
        : { key: { pubkey: identity.pubkey, provider: identity.provider } },
    );
  }

  // Dev-only auto-login so editing works locally without a real round-trip —
  // unless this browser has deliberately logged out (see DELETE).
  const dev = cookies.get(DEV_LOGOUT_COOKIE) ? null : devProfile();
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
  // Hold the dev auto-login off until someone logs in for real, so "log out"
  // means the same thing locally as it does in production.
  if (!import.meta.env.PROD)
    cookies.set(DEV_LOGOUT_COOKIE, "1", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
      maxAge: 60 * 60 * 24 * 365,
      ...(domain ? { domain } : {}),
    });
  return json({ ok: true });
};
