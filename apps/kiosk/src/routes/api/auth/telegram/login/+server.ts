// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// GET /api/auth/telegram/login — start the Telegram OIDC (auth-code + PKCE)
// flow: stash the PKCE verifier + state in short-lived cookies and redirect to
// Telegram's authorization endpoint.

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

  const redirectUri = `${url.origin}/api/auth/telegram/callback`;
  redirect(
    302,
    buildAuthorizationUrl({
      clientId: cfg.clientId,
      redirectUri,
      state,
      codeChallenge: challenge,
    }),
  );
};
