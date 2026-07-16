// SPDX-License-Identifier: AGPL-3.0-or-later
//
// GET /api/avatar?user_id=<telegram user id> — the user's current profile
// photo, resolved through the Bot API (getUserProfilePhotos → getFile) and
// streamed back. Replaces the retired telegram.holons.io/getavatar service.
// 404 when the user has no photo, hides them via privacy settings, or no
// configured bot knows them — callers already hide broken avatar images.

import type { RequestHandler } from "./$types";
import {
  forgetResolved,
  hasBotToken,
  resolveAvatarFile,
  streamFile,
} from "$lib/server/telegramFiles";

const USER_ID_RE = /^-?\d{1,20}$/;

export const GET: RequestHandler = async ({ url }) => {
  const userId = url.searchParams.get("user_id")?.trim() ?? "";
  if (!USER_ID_RE.test(userId)) {
    return new Response("invalid user_id", { status: 400 });
  }
  if (!hasBotToken()) {
    return new Response("no bot token configured", { status: 503 });
  }

  const resolved = await resolveAvatarFile(userId);
  if (!resolved) {
    return new Response("no profile photo", { status: 404 });
  }

  // Avatars change occasionally — cache for a day, not immutable.
  const response = await streamFile(resolved, "public, max-age=86400");
  if (!response) {
    forgetResolved("avatar", userId); // path may have expired — retry fresh
    return new Response("file fetch failed", { status: 404 });
  }
  return response;
};
