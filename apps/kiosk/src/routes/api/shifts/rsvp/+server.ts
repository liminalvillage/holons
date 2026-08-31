// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Shift signups for Telegram-logged-in kiosk users, signed UNDER THE USER'S
// OWN derived key — the same `deriveTelegramNostrKey(telegramId, secret)`
// identity the bot's /shifts and the web dashboard sign with, so one person
// is one pubkey across every surface. The kiosk is a shared screen, so the
// key itself never leaves this server: the browser proves who it is with the
// session cookie and says which occurrence and status; derivation, signing
// and relay publish all happen here. (Key-login users sign client-side with
// their own adopted key instead — see $lib/shifts.)
//
// GET  → { pubkey }   the session user's derived shift pubkey (never the key)
// POST { address, status } → sign + publish the kind-31925 RSVP
//
// Needs `NOSTR_DERIVATION_SECRET` (root .env / deploy env — same value as
// the bot and web, or the derived keys won't match). Without it both verbs
// answer 501 and the board stays read-only.

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { env } from "$env/dynamic/private";
import { deriveTelegramNostrKey } from "@holons/core/auth";
import {
  createShiftRelayClient,
  parseShiftAddress,
  parseShiftDTag,
  SHIFT_OCCURRENCE_KIND,
} from "@holons/core/shifts";
import {
  authConfig,
  verifySessionIdentity,
  SESSION_COOKIE,
} from "$lib/server/telegramAuth";

/** Relays to publish RSVPs to — must include the one the board reads. */
function shiftRelays(): string[] {
  const raw =
    (env.KIOSK_SHIFT_RELAYS || "").trim() ||
    (env.VITE_KIOSK_SHIFT_RELAYS || "").trim() ||
    (env.SHIFTS_RELAYS || "").trim() ||
    "wss://relay.commonshub.dev";
  return raw
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

/** Coordinator pubkey RSVPs may target, when the deploy pins one. */
function coordinator(): string | null {
  const v = (
    env.KIOSK_SHIFT_COORDINATOR ||
    env.VITE_KIOSK_SHIFT_COORDINATOR ||
    env.SHIFTS_COORDINATOR_PUBKEY ||
    ""
  )
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{64}$/.test(v) ? v : null;
}

/** The session's Telegram id, or null (no session / key-based session). */
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
  return json({ pubkey: deriveTelegramNostrKey(id, secret).publicKey });
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

  let body: { address?: unknown; status?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const status = body.status === "declined" ? "declined" : "accepted";

  // The occurrence is reconstructed from its address alone — the d-tag
  // grammar carries group/date/code, which is everything the RSVP template
  // needs. Strict parsing (plus the optional coordinator pin) is the guard:
  // a malformed or foreign-kind address never gets a signature.
  const addr = parseShiftAddress(String(body.address ?? ""));
  if (!addr || addr.kind !== SHIFT_OCCURRENCE_KIND) {
    return json({ error: "Not a shift occurrence address" }, { status: 400 });
  }
  const key = parseShiftDTag(addr.dTag);
  if (!key || key.kind !== "shift") {
    return json({ error: "Not a shift occurrence address" }, { status: 400 });
  }
  const pinned = coordinator();
  if (pinned && addr.pubkey !== pinned) {
    return json(
      { error: "Occurrence is not from the trusted coordinator" },
      { status: 400 },
    );
  }

  const { privateKey, publicKey } = deriveTelegramNostrKey(id, secret);
  const client = createShiftRelayClient({
    relays: shiftRelays(),
    // Serverless budget: keep the previous-RSVP lookup snappy.
    maxWait: 4000,
  });
  try {
    const occurrence = {
      address: String(body.address),
      dTag: addr.dTag,
      groupId: key.groupId,
      date: key.date,
      code: key.code,
    };
    const { event, results } = await client.publishRsvp({
      occurrence,
      status,
      participantPrivateKey: privateKey,
    });
    const accepted = results.filter((r) => r.status === "fulfilled").length;
    if (!accepted) {
      const firstErr = results.find(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      return json(
        { error: `No relay accepted the signup: ${firstErr?.reason}` },
        { status: 502 },
      );
    }
    return json({
      ok: true,
      pubkey: publicKey,
      status,
      id: event.id,
      createdAt: event.created_at,
      relaysAccepted: accepted,
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Signup failed" },
      { status: 502 },
    );
  } finally {
    client.close();
  }
};
