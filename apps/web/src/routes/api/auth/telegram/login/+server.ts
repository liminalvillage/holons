// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// GET /api/auth/telegram/login — start the Telegram OIDC Authorization Code +
// PKCE flow. Stashes the PKCE verifier + state in short-lived httpOnly cookies
// and redirects the browser to Telegram's authorization endpoint.

import { redirect, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  authConfig,
  generatePkce,
  generateState,
  buildAuthorizationUrl,
  transientCookieOptions,
} from "$lib/server/telegramAuth";

export const GET: RequestHandler = async ({ url, cookies }) => {
  const cfg = authConfig();
  if (!cfg.clientId) {
    error(500, "Telegram OIDC is not configured (TELEGRAM_OIDC_CLIENT_ID)");
  }

  const { verifier, challenge } = generatePkce();
  const state = generateState();
  const opts = transientCookieOptions(url.protocol === "https:");
  cookies.set("tg_oidc_verifier", verifier, opts);
  cookies.set("tg_oidc_state", state, opts);

  // Remember where login started so the callback can send the user back
  // (e.g. a deep link into a holon). Only same-origin relative paths — a
  // leading "/" but not "//" (protocol-relative) — to avoid open redirects.
  const returnTo = url.searchParams.get("returnTo");
  if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
    cookies.set("tg_oidc_return", returnTo, opts);
  }

  const redirectUri = `${url.origin}/api/auth/telegram/callback`;
  const authUrl = buildAuthorizationUrl({
    clientId: cfg.clientId,
    redirectUri,
    state,
    codeChallenge: challenge,
  });

  redirect(302, authUrl);
};
