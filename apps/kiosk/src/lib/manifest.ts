// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The web app manifest, per holon. One deploy serves every holon, but a home
// screen icon is for ONE of them: it should carry that hub's name and open
// that hub's board. A static manifest can do neither — its `start_url` is `/`,
// and an installed app on iOS starts with empty storage (nothing remembered
// from Safari), so `/` there is the front door, not the board the person was
// looking at when they added it. So the layout points `<link rel="manifest">`
// at `/api/manifest` with the board's start path and name, and that route
// answers with `buildManifest`. `static/manifest.webmanifest` stays as the
// no-holon fallback — keep the two in step.

import { holonForHost, holonForPath } from "./holons";

export const MANIFEST_ROUTE = "/api/manifest";

const DEFAULT_NAME = "Holons";
const NAME_MAX = 60;
/** `/`, `/<segment>`, or `/?holon=<id>` — nothing that leaves the origin. */
const START_RE = /^\/(?:[A-Za-z0-9._~%-]+|\?holon=[A-Za-z0-9._~%-]+)?$/;

/**
 * Where an installed app should open to land on `holon`, as this address
 * names it: a hub's own host already means it (`/`); otherwise the path
 * segment — the label the URL already uses when there is one, else the id;
 * and for an id the path grammar can't carry, the `?holon=` override.
 */
export function startPathFor(
  holon: string | null,
  loc: { hostname: string; pathname: string },
): string {
  if (!holon) return "/";
  if (holonForHost(loc.hostname) === holon) return "/";
  if (holonForPath(loc.pathname) === holon) {
    const seg = loc.pathname.replace(/^\/+/, "").split("/")[0];
    return `/${seg}`;
  }
  const byId = `/${encodeURIComponent(holon)}`;
  if (holonForPath(byId) === holon) return byId;
  return `/?holon=${encodeURIComponent(holon)}`;
}

/** The manifest URL for a board — the static file when there is no holon. */
export function manifestHref(start: string, name: string): string {
  if (start === "/" && !name.trim()) return "/manifest.webmanifest";
  const q = new URLSearchParams({ start });
  if (name.trim()) q.set("name", name.trim());
  return `${MANIFEST_ROUTE}?${q}`;
}

/** Untrusted query input → a manifest. Anything off-grammar falls back to `/`. */
export function buildManifest(startRaw: string | null, nameRaw: string | null) {
  const start = startRaw && START_RE.test(startRaw) ? startRaw : "/";
  const name = (nameRaw ?? "").trim().slice(0, NAME_MAX) || DEFAULT_NAME;
  return {
    name,
    short_name: name,
    description: "Calendar, tasks, and the library of things for the hub.",
    // The id is what makes two hubs two apps on one home screen.
    id: start,
    start_url: start,
    scope: "/",
    display: "fullscreen",
    orientation: "portrait",
    background_color: "#f7f4ec",
    theme_color: "#0e6b66",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      { src: "/icon-512.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
