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
  resolveFileById,
  streamFile,
} from "$lib/server/telegramFiles";

/** Telegram file_ids never contain anything outside this set. */
const FILE_ID_RE = /^[A-Za-z0-9_-]{10,128}$/;

export const GET: RequestHandler = async ({ url }) => {
  const fileId = url.searchParams.get("file_id")?.trim() ?? "";
  if (!FILE_ID_RE.test(fileId)) {
    return new Response("invalid file_id", { status: 400 });
  }
  if (!hasBotToken()) {
    return new Response("no bot token configured", { status: 503 });
  }

  const resolved = await resolveFileById(fileId);
  if (!resolved) {
    return new Response("file not found via getFile", { status: 404 });
  }

  // A file_id's content never changes — let browsers/CDNs keep it.
  const response = await streamFile(
    resolved,
    "public, max-age=604800, immutable",
  );
  if (!response) {
    forgetResolved("file", fileId); // path may have expired — retry fresh
    return new Response("file fetch failed", { status: 404 });
  }
  return response;
};
