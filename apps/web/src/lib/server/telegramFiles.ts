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
//
// Deploys WITHOUT a suitable token can delegate to a peer deploy that has
// one (IMAGE_PROXY_URL, e.g. https://dashboard.holons.io/api) — see the
// peer-proxy fallback below. The token itself is env-only on whichever host
// holds it: read exclusively through $env/dynamic/private at runtime, never
// VITE_-prefixed, so it cannot reach a client bundle or the repo.

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
  const name = resolved.path.split("/").pop() ?? "image";
  return imageResponse(bytes, name, cacheControl, MIME_BY_EXT[ext]);
}

/** Build the inline-image response (real type sniffed from magic bytes). */
function imageResponse(
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
  cacheControl: string,
  fallbackType?: string,
): Response {
  const type = sniffImageMime(bytes) ?? fallbackType ?? "image/jpeg";
  return new Response(bytes, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="${name.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": cacheControl,
    },
  });
}

// ── Peer-app proxy fallback ─────────────────────────────────────────────────
//
// One deploy holds the community bot's token (env-only); every other deploy —
// other hubs' kiosks, self-hosted dashboards — can point IMAGE_PROXY_URL at
// that deploy's API base (default https://dashboard.holons.io/api) and its
// /image and /avatar routes are used as a one-hop upstream of the exact same
// shape, honest 404s included. Two guards keep this from ever looping:
// a hop-marker header (a proxied request is never re-proxied) and a
// same-origin check (a deploy never proxies to itself). Set IMAGE_PROXY_URL
// to "off" to disable the fallback entirely.

const DEFAULT_IMAGE_PROXY = "https://dashboard.holons.io/api";

/** Marks a proxied request so the upstream never proxies it onward. */
export const PROXY_HOP_HEADER = "x-holons-image-proxy";

function proxyBase(): string | null {
  const raw = (env.IMAGE_PROXY_URL || DEFAULT_IMAGE_PROXY).trim();
  if (raw === "off" || raw === "0" || raw === "false") return null;
  const base = raw.replace(/\/+$/, "");
  return /^https?:\/\//.test(base) ? base : null;
}

/** Whether the peer-proxy fallback is configured (503 vs 404 gating). */
export function hasProxyConfigured(): boolean {
  return proxyBase() !== null;
}

async function proxyFetch(
  pathAndQuery: string,
  requestOrigin: string,
  hopped: boolean,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (hopped) return null; // already one hop deep — never chain proxies
  const base = proxyBase();
  if (!base) return null;
  try {
    if (new URL(base).origin === requestOrigin) return null; // self → loop
    const resp = await fetch(`${base}${pathAndQuery}`, {
      headers: { [PROXY_HOP_HEADER]: "1" },
    });
    if (!resp.ok) return null;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    // Accept only something that really is an image — error bodies must not
    // be cached as pictures.
    return bytes.length > 0 && sniffImageMime(bytes) ? bytes : null;
  } catch {
    return null; // upstream unreachable — the caller 404s
  }
}

/** Proxy a picture file_id through the peer deploy's /image route. */
export async function proxyImage(
  fileId: string,
  cacheControl: string,
  requestOrigin: string,
  hopped: boolean,
): Promise<Response | null> {
  const bytes = await proxyFetch(
    `/image?file_id=${encodeURIComponent(fileId)}`,
    requestOrigin,
    hopped,
  );
  return bytes ? imageResponse(bytes, "image", cacheControl) : null;
}

/** Proxy a user avatar through the peer deploy's /avatar route. */
export async function proxyAvatar(
  userId: string,
  cacheControl: string,
  requestOrigin: string,
  hopped: boolean,
): Promise<Response | null> {
  const bytes = await proxyFetch(
    `/avatar?user_id=${encodeURIComponent(userId)}`,
    requestOrigin,
    hopped,
  );
  return bytes ? imageResponse(bytes, "avatar", cacheControl) : null;
}

// ── Bot-server avatar cache (last resort, avatars only) ────────────────────
//
// getUserProfilePhotos respects each member's CURRENT privacy settings, so
// people who later hid their photo from bots 404 above even though the
// community bot cached their avatar on disk while it was still visible. That
// cache (telegram-ui Server.js /getavatar) is the only remaining source for
// them. Members with no real photo anywhere get the endpoint's deterministic
// jdenticon (SVG) passed through — the same mark the bot shows — after a
// benign-SVG check, served sandboxed. No hop/loop concerns — the bot server
// never calls back into these routes. BOT_API_URL / VITE_BOT_API_URL
// override the default; "off" disables.

const DEFAULT_BOT_SERVER = "https://telegram.holons.io";

function botServerBase(): string | null {
  const raw = (
    env.BOT_API_URL ||
    env.VITE_BOT_API_URL ||
    DEFAULT_BOT_SERVER
  ).trim();
  if (raw === "off" || raw === "0" || raw === "false") return null;
  const base = raw.replace(/\/+$/, "");
  return /^https?:\/\//.test(base) ? base : null;
}

/**
 * Whether a body is a benign SVG document — the shape jdenticon produces.
 * Anything with active content is rejected outright; real photos never take
 * this path (they're sniffed as raster images first).
 */
function isPlainSvg(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  const head = text.trimStart().toLowerCase();
  if (!head.startsWith("<svg") && !head.startsWith("<?xml")) return false;
  const all = text.toLowerCase();
  return (
    !all.includes("<script") &&
    !all.includes("javascript:") &&
    !all.includes("<foreignobject") &&
    !/\son\w+\s*=/.test(all)
  );
}

/** A user's avatar from the community bot's on-disk cache. */
export async function avatarFromBotCache(
  userId: string,
  cacheControl: string,
): Promise<Response | null> {
  const base = botServerBase();
  if (!base) return null;
  try {
    const resp = await fetch(
      `${base}/getavatar?user_id=${encodeURIComponent(userId)}`,
    );
    if (!resp.ok) return null;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (bytes.length === 0) return null;
    if (sniffImageMime(bytes)) {
      return imageResponse(bytes, "avatar", cacheControl);
    }
    // Photo-less members: the bot's deterministic identicon, passed through
    // sandboxed (CSP) so an SVG from the upstream can never run anything.
    if (isPlainSvg(bytes)) {
      return new Response(bytes, {
        headers: {
          "Content-Type": "image/svg+xml",
          "Content-Length": String(bytes.length),
          "Content-Disposition": 'inline; filename="avatar.svg"',
          "Cache-Control": cacheControl,
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return null;
  } catch {
    return null; // bot host unreachable — the caller 404s
  }
}

/** Drop a cached resolution (after a failed fetch — the path expired). */
export function forgetResolved(kind: "file" | "avatar", id: string): void {
  cache.delete(`${kind}:${id}`);
}
