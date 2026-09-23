// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Fund-claim log entries for Telegram-logged-in kiosk users, signed UNDER THE
// USER'S OWN derived key — the same `deriveTelegramNostrKey(telegramId,
// secret)` identity the bot and the web sign with, so the entry counts as
// theirs when every reader folds the `flow_claims` log. The kiosk is a shared
// screen, so the key never leaves this server: the browser proves who it is
// with the session cookie and says what it wants to record; derivation and
// signing happen here, and the browser applies + publishes the signed event
// through its own holosphere (`appendSigned`). Nothing is published from
// here — a lambda has no relay to keep. (Key-login users sign client-side
// with their adopted key instead — see $lib/flowsClaims.)
//
// GET  → { pubkey }                          the session user's log pubkey
// POST { holon, lens, item, refs? } → { event }   the signed kind-1808 entry
//
// What this will sign is narrow on purpose: an entry to the claims log whose
// `claim` names the session user as the party. Verdicts and payouts are
// signed as asked — whether they COUNT is the reducer's call, from the
// holon's policy and signer set, not this route's.

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { env } from "$env/dynamic/private";
import { createIdentityContext } from "@holons/core/holosphere";
import { logTemplate, isAttestation } from "@holons/core/protocol";
import { FLOW_CLAIMS_LENS, isClaim, isPayout } from "@holons/core/flows";
import { resolveAppName } from "$lib/config";
import {
  authConfig,
  verifySessionIdentity,
  SESSION_COOKIE,
} from "$lib/server/telegramAuth";

const LENSES = new Set<string>([FLOW_CLAIMS_LENS]);

async function telegramId(cookie: string | undefined): Promise<string | null> {
  const identity = await verifySessionIdentity(cookie, authConfig().jwtSecret);
  return identity?.kind === "telegram" ? String(identity.profile.id) : null;
}

export const GET: RequestHandler = async ({ cookies }) => {
  const secret = (env.NOSTR_DERIVATION_SECRET || "").trim();
  if (!secret) {
    return json(
      { error: "NOSTR_DERIVATION_SECRET is not configured" },
      { status: 501 },
    );
  }
  const id = await telegramId(cookies.get(SESSION_COOKIE));
  if (!id) return json({ error: "Not a Telegram session" }, { status: 401 });
  const pubkey = createIdentityContext({ derivationSecret: secret }).memberPubkey(id);
  if (!pubkey) return json({ error: "Key derivation failed" }, { status: 500 });
  return json({ pubkey, party: id });
};

export const POST: RequestHandler = async ({ request, cookies }) => {
  const secret = (env.NOSTR_DERIVATION_SECRET || "").trim();
  if (!secret) {
    return json(
      { error: "NOSTR_DERIVATION_SECRET is not configured" },
      { status: 501 },
    );
  }
  const id = await telegramId(cookies.get(SESSION_COOKIE));
  if (!id) return json({ error: "Not a Telegram session" }, { status: 401 });

  let body: { holon?: unknown; lens?: unknown; item?: unknown; refs?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const holon = String(body.holon ?? "").trim();
  const lens = String(body.lens ?? "").trim();
  const item = body.item;
  if (!holon) return json({ error: "holon is required" }, { status: 400 });
  if (!LENSES.has(lens)) return json({ error: `Not a log this route signs: ${lens}` }, { status: 400 });
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return json({ error: "item must be an object" }, { status: 400 });
  }
  if (isClaim(item)) {
    if (String(item.party) !== id || item.onBehalfOf) {
      return json({ error: "A claim is signed for the session user only" }, { status: 403 });
    }
  } else if (!isPayout(item) && !isAttestation(item)) {
    return json({ error: "Not a claim, a verdict or a payout" }, { status: 400 });
  }
  const refs =
    body.refs && typeof body.refs === "object" && !Array.isArray(body.refs)
      ? (body.refs as Record<string, string | string[]>)
      : undefined;

  const signer = createIdentityContext({ derivationSecret: secret }).memberSigner(id);
  if (!signer) return json({ error: "Key derivation failed" }, { status: 500 });
  const event = signer.sign(
    logTemplate({
      holon,
      lens,
      appName: resolveAppName(),
      item: item as unknown as Record<string, unknown>,
      refs,
    }),
  );
  return json({ event, pubkey: signer.pubkey, party: id });
};
