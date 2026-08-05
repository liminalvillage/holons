// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// GET /api/auth/telegram/callback — finish the OIDC flow on the canonical host
// (TELEGRAM_OIDC_CALLBACK_ORIGIN): validate state, exchange the code for an
// id_token (verified against Telegram's JWKS), mint the session cookie scoped to
// .hubs.network (shared across all tenants), then redirect back to the
// subdomain the user started on.

import { redirect, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  authConfig,
  exchangeCodeForProfile,
  mintSession,
  sessionCookieOptions,
  cookieDomain,
  isAllowedReturnOrigin,
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
  const returnTo = cookies.get("tg_oidc_return");

  // One-shot: clear the transient cookies regardless of outcome. They were set
  // with the .hubs.network domain (so this canonical host could read them), so
  // delete them with the same domain.
  const domain = cookieDomain(url.hostname);
  const clear = { path: "/", ...(domain ? { domain } : {}) };
  cookies.delete("tg_oidc_state", clear);
  cookies.delete("tg_oidc_verifier", clear);
  cookies.delete("tg_oidc_return", clear);

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

  // Must byte-match the redirect_uri sent at /login: the canonical origin.
  const callbackOrigin = cfg.callbackOrigin || url.origin;
  let profile: TelegramProfile;
  try {
    profile = await exchangeCodeForProfile({
      code,
      redirectUri: `${callbackOrigin}/api/auth/telegram/callback`,
      codeVerifier: verifier,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
    });
  } catch (e) {
    // The underlying reason (e.g. token endpoint "invalid_client") is
    // diagnostic and contains no secret — surface it.
    const reason = e instanceof Error ? e.message : String(e);
    console.error("OIDC code exchange/verify failed:", e);
    error(401, `Telegram authentication failed: ${reason}`);
  }

  const token = await mintSession(profile, cfg.jwtSecret);
  cookies.set(
    SESSION_COOKIE,
    token,
    sessionCookieOptions(url.protocol === "https:", domain),
  );

  // Send the user back to the subdomain they started on (the session cookie is
  // .hubs.network-wide, so it's visible there). Fall back to this host's root.
  const dest = isAllowedReturnOrigin(returnTo) ? `${returnTo}/` : "/";
  redirect(303, dest);
};
