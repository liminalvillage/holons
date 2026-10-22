// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Minimal offline shell for the kiosk. Precaches the built app so the entrance
// screen survives a flaky network; live holon data still flows through
// Holosphere (the relays) when connectivity returns. Navigations fall back to the
// cached shell (SPA), everything else is cache-first.

/// <reference types="@sveltejs/kit" />
import { build, files, version } from "$service-worker";

const CACHE = `kiosk-${version}`;
const ASSETS = [...build, ...files];
/**
 * The app shell. With ssr off every page is this same HTML, but nothing is
 * prerendered — there is no /index.html among the build files — so the shell
 * is fetched from the server at install and kept under its own key.
 */
const SHELL = "/";

/** The shell as a plain 200: a navigation must not be answered with a
 *  redirected response, and `/` on a hub's host may have been one. */
async function fetchShell(): Promise<Response | null> {
  try {
    const res = await fetch(SHELL, { cache: "reload" });
    if (!res.ok) return null;
    return new Response(await res.blob(), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch {
    return null;
  }
}

const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(ASSETS);
      // Best effort: a failed shell fetch must not keep the worker from installing.
      const shell = await fetchShell();
      if (shell) await cache.put(SHELL, shell);
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
  if (url.origin !== location.origin) return; // let relay traffic pass through

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
