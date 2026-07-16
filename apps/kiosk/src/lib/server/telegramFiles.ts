// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Server-side Telegram file resolution shared by /api/image and /api/avatar.
//
// Everything the app displays from Telegram (task/library pictures stored as
// file_ids, user avatars looked up by user_id) is fetched first-party through
// the Bot API — getFile for files, getUserProfilePhotos → getFile for
// avatars — instead of the retired telegram.holons.io image server, which
// hid a dead token behind placeholder responses.
//
// file_ids are bot-scoped: a file can only be fetched with the token of the
// bot that produced it, and the graph mixes uploads from the community bot
// and the dev login bot. Every configured token is therefore tried in order
// until one resolves — which also keeps dev-bot content rendering while the
// community bot's token is revoked or rotated.

import { env } from "$env/dynamic/private";

export interface ResolvedFile {
  token: string;
  path: string;
}

function botTokens(): string[] {
  const raw = [env.BOT_TOKEN, env.TELEGRAM, env.VITE_TELEGRAM_BOT_TOKEN];
  // The .env values have been seen carrying stray control characters —
  // strip anything a real token can't contain, and dedupe.
  const cleaned = raw
    .map((t) => (t ?? "").replace(/[^A-Za-z0-9:_-]/g, ""))
    .filter((t) => t.length > 0);
  return [...new Set(cleaned)];
}

/** Whether any bot token is configured at all (503 vs 404 in the routes). */
export function hasBotToken(): boolean {
  return botTokens().length > 0;
}

// Telegram guarantees a file_path stays valid for at least an hour; cached
// entries expire well before that. Keyed by "<kind>:<id>", per server
// instance.
const cache = new Map<string, { entry: ResolvedFile; at: number }>();
const TTL_MS = 45 * 60 * 1000;

function cached(key: string): ResolvedFile | null {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < TTL_MS ? hit.entry : null;
}

async function getFile(token: string, fileId: string): Promise<string | null> {
  const resp = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  if (!resp.ok) return null;
  const data = (await resp.json().catch(() => null)) as {
    ok?: boolean;
    result?: { file_path?: string };
  } | null;
  return (data?.ok ? data.result?.file_path : undefined) ?? null;
}

/** file_id → {token, file_path}, trying each configured bot. */
export async function resolveFileById(
  fileId: string,
): Promise<ResolvedFile | null> {
  const key = `file:${fileId}`;
  const hit = cached(key);
  if (hit) return hit;
  for (const token of botTokens()) {
    const path = await getFile(token, fileId);
    if (path) {
      const entry = { token, path };
      cache.set(key, { entry, at: Date.now() });
      return entry;
    }
  }
  return null;
}

/**
 * user_id → the user's current profile photo as {token, file_path}, via
 * getUserProfilePhotos. The photo's file_id is scoped to the bot that
 * returned it, so getFile runs with that same token.
 */
export async function resolveAvatarFile(
  userId: string,
): Promise<ResolvedFile | null> {
  const key = `avatar:${userId}`;
  const hit = cached(key);
  if (hit) return hit;
  for (const token of botTokens()) {
    const resp = await fetch(
      `https://api.telegram.org/bot${token}/getUserProfilePhotos?user_id=${encodeURIComponent(userId)}&limit=1`,
    );
    if (!resp.ok) continue;
    const data = (await resp.json().catch(() => null)) as {
      ok?: boolean;
      result?: { photos?: Array<Array<{ file_id?: string }>> };
    } | null;
    const sizes = data?.ok ? (data.result?.photos?.[0] ?? []) : [];
    // Sizes come smallest-first (160/320/640…) — the second is plenty for
    // the avatar chips the app renders.
    const fileId = sizes[Math.min(1, sizes.length - 1)]?.file_id;
    if (!fileId) continue;
    const path = await getFile(token, fileId);
    if (path) {
      const entry = { token, path };
      cache.set(key, { entry, at: Date.now() });
      return entry;
    }
  }
  return null;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

/** Detect the real image type from the file's magic bytes. */
function sniffImageMime(bytes: Uint8Array): string | null {
  const at = (i: number) => bytes[i] ?? 0;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47)
    return "image/png";
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return "image/gif";
  if (
    at(0) === 0x52 &&
    at(1) === 0x49 &&
    at(2) === 0x46 &&
    at(3) === 0x46 &&
    at(8) === 0x57 &&
    at(9) === 0x45 &&
    at(10) === 0x42 &&
    at(11) === 0x50
  )
    return "image/webp";
  return null;
}

/**
 * Serve the resolved file back to the client. Returns null when the fetch
 * fails (e.g. the cached file_path expired) — the caller 404s and the stale
 * cache entry is dropped so the next request re-resolves.
 *
 * Telegram's file server labels everything application/octet-stream, which
 * makes browsers DOWNLOAD the file instead of rendering it. The body is
 * buffered (bot-API files cap at 20 MB; pictures are far smaller) so the
 * real image type can be sniffed from its magic bytes, and the response is
 * explicitly marked inline.
 */
export async function streamFile(
  resolved: ResolvedFile,
  cacheControl: string,
): Promise<Response | null> {
  const file = await fetch(
    `https://api.telegram.org/file/bot${resolved.token}/${resolved.path}`,
  );
  if (!file.ok) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) return null;
  const ext = resolved.path.split(".").pop()?.toLowerCase() ?? "";
  const type = sniffImageMime(bytes) ?? MIME_BY_EXT[ext] ?? "image/jpeg";
  const name = resolved.path.split("/").pop() ?? "image";
  return new Response(bytes, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="${name.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": cacheControl,
    },
  });
}

/** Drop a cached resolution (after a failed fetch — the path expired). */
export function forgetResolved(kind: "file" | "avatar", id: string): void {
  cache.delete(`${kind}:${id}`);
}
