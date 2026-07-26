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
  const savedReturnTo = cookies.get("tg_oidc_return");

  // One-shot: clear the transient cookies regardless of outcome.
  cookies.delete("tg_oidc_state", { path: "/" });
  cookies.delete("tg_oidc_verifier", { path: "/" });
  cookies.delete("tg_oidc_return", { path: "/" });

  if (oauthError) {
    error(401, `Telegram login error: ${oauthError}`);
  }
  if (!code) error(400, "OAuth callback: missing ?code");
  if (!state) error(400, "OAuth callback: missing ?state");
  if (!savedState || !verifier) {
    error(
      400,
      "OAuth callback: login cookies not sent back (tg_oidc_state/verifier missing). " +
        "This happens if the callback URL was reloaded, login was started in a different " +
        "browser/tab, or cookies are blocked. Start a fresh login from the button.",
    );
  }
  if (state !== savedState) {
    error(400, "OAuth callback: state mismatch — start a fresh login.");
  }

  // Surface misconfiguration plainly instead of a generic "auth failed".
  if (!cfg.clientId || !cfg.clientSecret || !cfg.jwtSecret) {
    const missing = [
      !cfg.clientId && "TELEGRAM_OIDC_CLIENT_ID",
      !cfg.clientSecret && "TELEGRAM_OIDC_CLIENT_SECRET",
      !cfg.jwtSecret && "AUTH_JWT_SECRET",
    ]
      .filter(Boolean)
      .join(", ");
    error(500, `Telegram OIDC is not configured — missing: ${missing}`);
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
    // The underlying reason (e.g. token endpoint "invalid_client" or a
    // redirect_uri mismatch) is diagnostic and contains no secret — surface it.
    const reason = e instanceof Error ? e.message : String(e);
    console.error("OIDC code exchange/verify failed:", e);
    error(401, `Telegram authentication failed: ${reason}`);
  }

  const token = await mintSession(profile, cfg.jwtSecret);
  cookies.set(
    SESSION_COOKIE,
    token,
    sessionCookieOptions(url.protocol === "https:"),
  );

  // Back to where login started (deep link into a holon), if we recorded one.
  // Re-validate: cookies are client-writable, so only same-origin relative
  // paths ("/..." but not "//...") are honored.
  const returnTo =
    savedReturnTo &&
    savedReturnTo.startsWith("/") &&
    !savedReturnTo.startsWith("//")
      ? savedReturnTo
      : "/";
  redirect(303, returnTo);
};
