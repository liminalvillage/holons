// SPDX-License-Identifier: AGPL-3.0-or-later
//
// GET /api/manifest?start=<path>&name=<holon name> — the web app manifest for
// one holon's board, so its home screen icon is named for the hub and opens
// on it. The shape and the input rules live in $lib/manifest.

import type { RequestHandler } from "./$types";
import { buildManifest } from "$lib/manifest";

export const GET: RequestHandler = ({ url }) =>
  new Response(
    JSON.stringify(
      buildManifest(
        url.searchParams.get("start"),
        url.searchParams.get("name"),
      ),
    ),
    {
      headers: {
        "content-type": "application/manifest+json; charset=utf-8",
        // Pure function of the query string; a rename is a new URL.
        "cache-control": "public, max-age=3600",
      },
    },
  );
