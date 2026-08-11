// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// /api/ai/voice/* — OpenAI proxy for the kiosk's direct voice mode, holding
// the SAME server-side key the AI-breakdown route reads (OPENAI_API_KEY in
// the deploy's env). A kiosk whose deploy is configured for breakdown gets
// voice with no per-device key pasting; a key pasted in Settings still wins
// (see $lib/voice/direct).
//
// Only the three endpoints the voice pipeline uses are forwarded — this is a
// narrow relay, not a general OpenAI proxy:
//   POST audio/transcriptions   (Whisper STT, multipart WAV)
//   POST chat/completions       (the agent loop)
//   POST audio/speech           (tts-1, streamed PCM passthrough)
//
// GET reports `{ configured }` so the client can decide between this route
// and the device-key direct call without shipping the key or guessing.
//
// Session-gated in production, exactly like /api/ai/breakdown: without the
// gate this would be an open proxy to the deploy's OpenAI key.

import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import type { RequestHandler } from "./$types";
import {
  verifySession,
  authConfig,
  SESSION_COOKIE,
} from "$lib/server/telegramAuth";

const API_BASE = "https://api.openai.com/v1";

/** The only upstream paths this relay will touch. */
const ALLOWED_PATHS = new Set([
  "audio/transcriptions",
  "chat/completions",
  "audio/speech",
]);

// Same env names the breakdown routes accept, so one deploy configuration
// (or the shared root .env in dev) powers both features.
function openaiKey(): string {
  return (
    env.OPENAI_API_KEY ||
    env.OPENAI ||
    env.VITE_OPENAI_API_KEY ||
    ""
  ).trim();
}

/** Whether this deploy can speak server-side. Public, leaks nothing. */
export const GET: RequestHandler = async () => {
  return json({ configured: openaiKey() !== "" });
};

export const POST: RequestHandler = async ({ request, cookies, params }) => {
  const key = openaiKey();
  if (!key) {
    return json(
      { error: "Voice is not configured (set OPENAI_API_KEY)." },
      { status: 503 },
    );
  }

  const path = (params.path ?? "").replace(/^\/+|\/+$/g, "");
  if (!ALLOWED_PATHS.has(path)) {
    return json({ error: "Unknown voice endpoint." }, { status: 404 });
  }

  if (import.meta.env.PROD) {
    const profile = await verifySession(
      cookies.get(SESSION_COOKIE),
      authConfig().jwtSecret,
    );
    if (!profile) {
      return json({ error: "Sign in to use voice." }, { status: 401 });
    }
  }

  // Rebuild the upstream request from scratch — only the body and its
  // content-type (which carries the multipart boundary for STT) come from
  // the client; auth is always the server's key, never a forwarded header.
  const body = await request.arrayBuffer();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
  };
  const contentType = request.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE}/${path}`, {
      method: "POST",
      headers,
      body,
    });
  } catch {
    return json({ error: "Could not reach OpenAI." }, { status: 502 });
  }

  if (!upstream.ok) {
    // Surface the status but keep upstream error bodies (which can echo key
    // fragments and internals) out of the client.
    const status =
      upstream.status === 401 || upstream.status === 403
        ? 502
        : upstream.status;
    console.error(
      `Voice proxy (${path}) upstream HTTP ${upstream.status}:`,
      (await upstream.text().catch(() => "")).slice(0, 300),
    );
    return json(
      {
        error:
          upstream.status === 401 || upstream.status === 403
            ? "AI provider rejected the configured API key."
            : upstream.status === 429
              ? "AI provider rate limit hit — try again shortly."
              : "AI request was rejected by the provider.",
      },
      { status },
    );
  }

  // Stream the success body straight through (TTS PCM chunks reach the
  // speaker as they arrive; JSON bodies pass through unchanged).
  const respHeaders = new Headers();
  const upstreamType = upstream.headers.get("content-type");
  if (upstreamType) respHeaders.set("Content-Type", upstreamType);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  });
};
