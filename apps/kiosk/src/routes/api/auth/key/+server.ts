// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// POST /api/auth/key — mint a session for a key-based identity.
//
// The browser already holds a Nostr key (an imported nsec or an Ethereum
// wallet signature). It proves ownership with a NIP-98 event bound to this
// URL; we verify the signature + freshness and set the same session cookie a
// Telegram login gets, with a `nostr:<pubkey>` subject. Stateless: no
// challenge store, no user table. (Port of the web app's endpoint.)

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { verifyAuthEvent } from "@holons/core/auth";
import {
  authConfig,
  mintKeySession,
  sessionCookieOptions,
  cookieDomain,
  SESSION_COOKIE,
  type KeyProvider,
} from "$lib/server/telegramAuth";

const PROVIDERS: KeyProvider[] = ["nostr", "ethereum"];

export const POST: RequestHandler = async ({ request, cookies, url }) => {
  const cfg = authConfig();
  if (!cfg.jwtSecret) {
    return json(
      { error: "AUTH_JWT_SECRET is not configured" },
      { status: 500 },
    );
  }

  let body: { event?: unknown; provider?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const verdict = verifyAuthEvent(body.event, {
    url: `${url.origin}/api/auth/key`,
    method: "POST",
  });
  if (!verdict.ok) {
    return json(
      { error: `Invalid auth proof (${verdict.reason})` },
      { status: 401 },
    );
  }

  const provider = PROVIDERS.includes(body.provider as KeyProvider)
    ? (body.provider as KeyProvider)
    : "nostr";
  const token = await mintKeySession(
    { pubkey: verdict.pubkey, provider },
    cfg.jwtSecret,
  );
  cookies.set(
    SESSION_COOKIE,
    token,
    sessionCookieOptions(url.protocol === "https:", cookieDomain(url.hostname)),
  );
  return json({ ok: true, pubkey: verdict.pubkey, provider });
};
