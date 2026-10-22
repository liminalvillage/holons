// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// GET /api/ical-proxy?url=… — fetch an external iCal feed on the browser's
// behalf. Needed because almost no calendar host (Google, iCloud, Nextcloud)
// sends CORS headers, so the kiosk can't read a subscribed feed directly.
//
// Read-only and unauthenticated, like the feed it mirrors: it returns exactly
// what a public calendar URL returns, and only for http/https/webcal.

import { error, type RequestHandler } from "@sveltejs/kit";

/** Brief cache so a board that re-renders doesn't hammer upstream. */
const CACHE_SECONDS = 300;

export const GET: RequestHandler = async ({ url, fetch }) => {
  const target = url.searchParams.get("url");
  if (!target) throw error(400, "Missing url query parameter");

  let feedUrl: URL;
  try {
    feedUrl = new URL(target);
  } catch {
    throw error(400, "Invalid url");
  }
  // `webcal:` is a subscribe hint, not a transport.
  if (feedUrl.protocol === "webcal:") feedUrl.protocol = "https:";
  if (feedUrl.protocol !== "http:" && feedUrl.protocol !== "https:") {
    throw error(400, "Only http/https/webcal URLs are allowed");
  }

  let upstream: Response;
  try {
    upstream = await fetch(feedUrl.toString(), {
      headers: { Accept: "text/calendar, text/plain, */*" },
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : "unknown";
    throw error(502, `Upstream fetch failed: ${reason}`);
  }
  if (!upstream.ok) {
    throw error(
      upstream.status,
      `Upstream responded ${upstream.status} ${upstream.statusText}`,
    );
  }

  return new Response(await upstream.text(), {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_SECONDS}`,
    },
  });
};
