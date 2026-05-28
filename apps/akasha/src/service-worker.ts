// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Minimal offline shell for the kiosk. Precaches the built app so the entrance
// screen survives a flaky network; live holon data still flows through
// Holosphere/Gun when connectivity returns. Navigations fall back to the
// cached shell (SPA), everything else is cache-first.

/// <reference types="@sveltejs/kit" />
import { build, files, version } from "$service-worker";

const CACHE = `akasha-${version}`;
const ASSETS = [...build, ...files];

const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
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
  if (url.origin !== location.origin) return; // let Gun/peer traffic pass through

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      if (ASSETS.includes(url.pathname)) {
        const cached = await cache.match(url.pathname);
        if (cached) return cached;
      }

      try {
        const res = await fetch(request);
        return res;
      } catch {
        // Offline: serve the SPA shell for navigations.
        if (request.mode === "navigate") {
          const shell = await cache.match("/index.html");
          if (shell) return shell;
        }
        const cached = await cache.match(request);
        if (cached) return cached;
        return new Response("offline", { status: 503, statusText: "offline" });
      }
    })(),
  );
});
