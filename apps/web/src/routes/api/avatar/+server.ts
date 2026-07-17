// SPDX-License-Identifier: AGPL-3.0-or-later
//
// GET /api/avatar?user_id=<telegram user id> — the user's current profile
// photo, resolved through the Bot API (getUserProfilePhotos → getFile) and
// streamed back. Replaces the retired telegram.holons.io/getavatar service.
// 404 when the user has no photo, hides them via privacy settings, or no
// configured bot knows them — callers already hide broken avatar images.

import type { RequestHandler } from "./$types";
import {
  avatarFromBotCache,
  forgetResolved,
  hasBotToken,
  hasProxyConfigured,
  PROXY_HOP_HEADER,
  proxyAvatar,
  resolveAvatarFile,
  streamFile,
} from "$lib/server/telegramFiles";

const USER_ID_RE = /^-?\d{1,20}$/;

// Avatars change occasionally — cache for a day, not immutable.
const CACHE = "public, max-age=86400";

export const GET: RequestHandler = async ({ url, request }) => {
  const userId = url.searchParams.get("user_id")?.trim() ?? "";
  if (!USER_ID_RE.test(userId)) {
    return new Response("invalid user_id", { status: 400 });
  }
  if (!hasBotToken() && !hasProxyConfigured()) {
    return new Response("no bot token or image proxy configured", {
      status: 503,
    });
  }

  // Directly via the configured tokens first — no extra hop …
  if (hasBotToken()) {
    const resolved = await resolveAvatarFile(userId);
    if (resolved) {
      const response = await streamFile(resolved, CACHE);
      if (response) return response;
      forgetResolved("avatar", userId); // path may have expired — retry fresh
    }
  }

  // … then one hop through a peer deploy whose token has actually met the
  // community's members (getUserProfilePhotos needs that) …
  const proxied = await proxyAvatar(
    userId,
    CACHE,
    url.origin,
    request.headers.has(PROXY_HOP_HEADER),
  );
  if (proxied) return proxied;

  // … and finally the bot's on-disk avatar cache: photos of members whose
  // privacy settings now hide them from the Bot API, or the bot's identicon
  // for members with no photo at all.
  const cachedAvatar = await avatarFromBotCache(userId, CACHE);
  if (cachedAvatar) return cachedAvatar;

  return new Response("no profile photo", { status: 404 });
};
