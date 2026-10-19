// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Minimal offline shell for Flows (the kiosk's, with the shell itself
// cached). Precaches the built app so the map opens with no network: the
// snapshot is already on the device (Holosphere's store, and the app's own
// cache of the last whole graph). Navigations fall back to the cached shell
// (SPA — one shell serves every route), everything else is cache-first.

/// <reference types="@sveltejs/kit" />
import { build, files, version } from "$service-worker";

const CACHE = `flows-${version}`;
const ASSETS = [...build, ...files];
/** The SPA shell: every route renders from it. */
const SHELL = "/";

const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(ASSETS);
      // The shell is served by a function, not a file: fetch it once here.
      // A failure must not fail the install — the app still works online.
      await cache.add(SHELL).catch(() => {});
    })(),
  );
  sw.skipWaiting();
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // let relay and chain traffic pass through
  if (url.pathname.startsWith("/api/")) return; // sign-in is never answered from a cache

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      if (ASSETS.includes(url.pathname)) {
        const cached = await cache.match(url.pathname);
        if (cached) return cached;
      }

      try {
        return await fetch(request);
      } catch {
        // Offline: serve the SPA shell for navigations.
        if (request.mode === "navigate") {
          const shell = await cache.match(SHELL);
          if (shell) return shell;
        }
        const cached = await cache.match(request);
        if (cached) return cached;
        return new Response("offline", { status: 503, statusText: "offline" });
      }
    })(),
  );
});
