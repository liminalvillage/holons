// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// GET /api/auth/telegram/login — start the Telegram OIDC (auth-code + PKCE)
// flow. Multi-tenant: the round-trip always uses ONE canonical callback origin
// (TELEGRAM_OIDC_CALLBACK_ORIGIN, e.g. https://hubs.network) so only that single
// redirect_uri must be registered in BotFather. We remember the originating
// subdomain so the callback can send the user back there afterwards. The
// transient cookies are scoped to .hubs.network so the canonical callback host
// can read them.

import { redirect, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  authConfig,
  generatePkce,
  generateState,
  buildAuthorizationUrl,
  transientCookieOptions,
  cookieDomain,
} from "$lib/server/telegramAuth";

export const GET: RequestHandler = async ({ url, cookies }) => {
  const cfg = authConfig();
  if (!cfg.clientId) {
    error(500, "Telegram OIDC is not configured (TELEGRAM_OIDC_CLIENT_ID)");
  }

  const { verifier, challenge } = generatePkce();
  const state = generateState();
  const domain = cookieDomain(url.hostname);
  const opts = transientCookieOptions(url.protocol === "https:", domain);
  // Asking to log in lifts the dev-only "stay logged out" hold (see the session
  // endpoint's DELETE) — released HERE rather than on the callback so that in
  // local dev, where the OIDC round-trip often can't complete, tapping "Log in"
  // still gets you back to the dev identity instead of stranding you.
  if (!import.meta.env.PROD)
    cookies.delete("kiosk_dev_logout", {
      path: "/",
      ...(domain ? { domain } : {}),
    });
  cookies.set("tg_oidc_verifier", verifier, opts);
  cookies.set("tg_oidc_state", state, opts);
  // Where to return the user after the canonical callback completes.
  cookies.set("tg_oidc_return", url.origin, opts);

  const callbackOrigin = cfg.callbackOrigin || url.origin;
  redirect(
    302,
    buildAuthorizationUrl({
      clientId: cfg.clientId,
      redirectUri: `${callbackOrigin}/api/auth/telegram/callback`,
      state,
      codeChallenge: challenge,
    }),
  );
};
