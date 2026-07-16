/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// SvelteKit auto-registers this file when present and exposes the
// `$service-worker` virtual module with the asset manifest for this build.
//
// Strategy:
// - Precache the immutable build output + static files on install.
// - Navigation requests: network-first so users get fresh routes when online,
//   fall back to cached shell when offline.
// - Same-origin static assets: cache-first (they're content-hashed).
// - Everything else (Gun peer, Mapbox tiles, Telegram SDK, Google Translate,
//   external APIs): bypass — let the network handle it. Caching live sync
//   traffic would be actively wrong.

import { build, files, version } from "$service-worker";

declare const self: ServiceWorkerGlobalScope;

const CACHE = `holons-cache-${version}`;
const AVATAR_CACHE = "holons-avatars-v1"; // version-independent: avatars are content-stable per user_id
const PRECACHE_URLS = [...build, ...files];

// User avatars come from the app's own `/api/avatar?user_id=...` route
// (Bot API getUserProfilePhotos → getFile) across the app (offers, roles,
// modals). Cache them stale-while-revalidate so they render instantly on
// revisit and survive offline. Versioned cache name stays separate from the
// build precache so a new release doesn't evict the user's avatar history.
const AVATAR_PATH = "/api/avatar";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE_URLS);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        // Drop old per-version build caches but keep the avatar cache
        // across releases — those entries are still useful.
        if (key !== CACHE && key !== AVATAR_CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin) return;

  // User-avatar requests: stale-while-revalidate.
  if (url.pathname.startsWith(AVATAR_PATH)) {
    event.respondWith(staleWhileRevalidate(request, AVATAR_CACHE));
    return;
  }

  const isPrecached = PRECACHE_URLS.includes(url.pathname);

  if (isPrecached) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(navigationHandler(request));
  }
});

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

// Return the cached response immediately (if any) while refreshing in the
// background. Falls back to a network fetch on the first miss. Suits user
// avatars: the URL is content-stable per user_id, occasional staleness is
// fine, and on revisit (especially offline) the image just appears.
async function staleWhileRevalidate(
  request: Request,
  cacheName: string,
): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchAndUpdate = fetch(request)
    .then((response) => {
      // Only cache successful 200s — /api/avatar returns 404s for
      // missing avatars, and caching those would pin the empty state
      // for the lifetime of the cache.
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached ?? (await fetchAndUpdate) ?? new Response("", { status: 504 });
}

async function navigationHandler(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(CACHE);
    const cached = (await cache.match(request)) ?? (await cache.match("/"));
    if (cached) return cached;
    return new Response("Offline and no cached page available.", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
