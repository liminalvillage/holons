// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// GET /api/auth/telegram/callback — finish the Telegram OIDC flow. Validates the
// state against the cookie, exchanges the auth code for an id_token (verified
// against Telegram's JWKS), mints our session cookie, and redirects into the app.
// The client then calls /api/auth/session to receive its derived signing key.

import { redirect, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  authConfig,
  exchangeCodeForProfile,
  mintSession,
  sessionCookieOptions,
  SESSION_COOKIE,
  type TelegramProfile,
} from "$lib/server/telegramAuth";

export const GET: RequestHandler = async ({ url, cookies }) => {
  const cfg = authConfig();
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const savedState = cookies.get("tg_oidc_state");
  const verifier = cookies.get("tg_oidc_verifier");

  // One-shot: clear the transient cookies regardless of outcome.
  cookies.delete("tg_oidc_state", { path: "/" });
  cookies.delete("tg_oidc_verifier", { path: "/" });

  if (oauthError) {
    error(401, `Telegram login error: ${oauthError}`);
  }
  if (!code || !state || !savedState || state !== savedState || !verifier) {
    error(400, "Invalid OAuth callback (state/code missing or mismatched)");
  }

  const redirectUri = `${url.origin}/api/auth/telegram/callback`;
  let profile: TelegramProfile;
  try {
    profile = await exchangeCodeForProfile({
      code,
      redirectUri,
      codeVerifier: verifier,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
    });
  } catch (e) {
    console.error("OIDC code exchange/verify failed:", e);
    error(401, "Telegram authentication failed");
  }

  const token = await mintSession(profile, cfg.jwtSecret);
  cookies.set(
    SESSION_COOKIE,
    token,
    sessionCookieOptions(url.protocol === "https:"),
  );

  redirect(303, "/");
};
