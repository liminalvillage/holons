// SPDX-License-Identifier: AGPL-3.0-or-later
//
// GET /api/image?file_id=<telegram file_id> — resolve a task/library picture
// through the Bot API getFile and stream it back. Fails with an honest 404
// (broken-image icon) instead of the retired image server's fake 1×1 pixel.
// Resolution details live in $lib/server/telegramFiles.

import type { RequestHandler } from "./$types";
import {
  forgetResolved,
  hasBotToken,
  hasProxyConfigured,
  PROXY_HOP_HEADER,
  proxyImage,
  resolveFileById,
  streamFile,
} from "$lib/server/telegramFiles";

/** Telegram file_ids never contain anything outside this set. */
const FILE_ID_RE = /^[A-Za-z0-9_-]{10,128}$/;

// A file_id's content never changes — let browsers/CDNs keep it.
const CACHE = "public, max-age=604800, immutable";

export const GET: RequestHandler = async ({ url, request }) => {
  const fileId = url.searchParams.get("file_id")?.trim() ?? "";
  if (!FILE_ID_RE.test(fileId)) {
    return new Response("invalid file_id", { status: 400 });
  }
  if (!hasBotToken() && !hasProxyConfigured()) {
    return new Response("no bot token or image proxy configured", {
      status: 503,
    });
  }

  // Directly via the configured tokens first — no extra hop …
  if (hasBotToken()) {
    const resolved = await resolveFileById(fileId);
    if (resolved) {
      const response = await streamFile(resolved, CACHE);
      if (response) return response;
      forgetResolved("file", fileId); // path may have expired — retry fresh
    }
  }

  // … then one hop through a peer deploy that holds the token this deploy
  // doesn't (file_ids are scoped to the community bot).
  const proxied = await proxyImage(
    fileId,
    CACHE,
    url.origin,
    request.headers.has(PROXY_HOP_HEADER),
  );
  if (proxied) return proxied;

  return new Response("file not found", { status: 404 });
};
