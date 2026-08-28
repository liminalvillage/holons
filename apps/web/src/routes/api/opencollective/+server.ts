// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// GET /api/opencollective?slug=… — read-only balance and recent movement for a
// holon's collective, for the Flows board.
//
// A relay rather than a browser fetch for two reasons: the dashboard's CSP does
// not list OpenCollective in `connect-src` (so a client call there fails before
// CORS is even considered), and an optional personal token must stay server-side.
// Core owns the query and the parser; this route owns only the network call.
//
// GET with no slug reports `{ configured }` so the client can tell "no token"
// from "no collective" without shipping either.
//
// Read-only and public: anonymous reads of a public collective need no session,
// so the route is ungated unless a token is configured — a token would make it
// an authenticated proxy worth protecting.

import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import type { RequestHandler } from "./$types";
import {
  COLLECTIVE_OVERVIEW_QUERY,
  OPENCOLLECTIVE_API_URL,
  isValidCollectiveSlug,
  normalizeCollectiveSlug,
  parseOpenCollectiveResponse,
} from "@holons/core/flows";
import {
  verifySession,
  authConfig,
  SESSION_COOKIE,
} from "$lib/server/telegramAuth";

/** How many recent transactions to summarise. */
const TX_LIMIT = 100;

/** Same trimmed fallback chain the other routes use for their keys. */
function collectiveToken(): string {
  return (env.OPENCOLLECTIVE_TOKEN || env.OPENCOLLECTIVE_API_KEY || "").trim();
}

export const GET: RequestHandler = async ({ url, cookies, fetch }) => {
  const raw = url.searchParams.get("slug") ?? "";
  const token = collectiveToken();

  // Capability probe. Says nothing about the token itself.
  if (!raw) {
    return json({ configured: true, authenticated: token !== "" });
  }

  const slug = normalizeCollectiveSlug(raw);
  if (!isValidCollectiveSlug(slug)) {
    return json({ error: "Invalid collective slug." }, { status: 400 });
  }

  // Only gate when this deploy would be lending out its own credentials.
  if (token && import.meta.env.PROD) {
    const profile = await verifySession(
      cookies.get(SESSION_COOKIE),
      authConfig().jwtSecret,
    );
    if (!profile) {
      return json(
        { error: "Sign in to read the collective." },
        { status: 401 },
      );
    }
  }

  try {
    const resp = await fetch(OPENCOLLECTIVE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "Personal-Token": token } : {}),
      },
      body: JSON.stringify({
        query: COLLECTIVE_OVERVIEW_QUERY,
        variables: { slug, limit: TX_LIMIT },
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      console.error(
        "[web] opencollective failed:",
        resp.status,
        detail.slice(0, 300),
      );
      if (resp.status === 401 || resp.status === 403) {
        return json(
          { error: "OpenCollective rejected the configured token." },
          { status: 502 },
        );
      }
      if (resp.status === 429) {
        return json(
          { error: "OpenCollective rate limit hit — try again shortly." },
          { status: 429 },
        );
      }
      return json({ error: "OpenCollective request failed." }, { status: 502 });
    }

    const body = await resp.json();

    // GraphQL reports a missing collective as a 200 with an errors array, so a
    // bad slug has to be caught here rather than by the status code.
    if (Array.isArray(body?.errors) && body.errors.length > 0) {
      const message = String(body.errors[0]?.message ?? "");
      console.error(
        "[web] opencollective graphql error:",
        message.slice(0, 300),
      );
      return json(
        { error: `No collective found for "${slug}".` },
        { status: 404 },
      );
    }

    const snapshot = parseOpenCollectiveResponse(body, slug);
    return json(snapshot, {
      // The balance moves slowly and the board re-reads every 30s; a short
      // cache keeps a pinned kiosk from hammering a public API all day.
      headers: { "cache-control": "public, max-age=300" },
    });
  } catch (err) {
    console.error("[web] opencollective request threw:", err);
    return json({ error: "OpenCollective request failed." }, { status: 502 });
  }
};
