// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Subdomain → holon registry. ONE kiosk deploy can serve every registered
// holon: the host's subdomain under the base domain selects which holon the
// screen shows, e.g.
//
//   liminal.hubs.network        → "liminal" → <holon id>
//   www.liminal.hubs.network    → "liminal" → <holon id>
//
// Point a wildcard domain (`*.hubs.network`) at the one Netlify site, then add
// an entry below for each holon you want reachable by subdomain. A `?holon=<id>`
// query param still overrides this (for testing), and hosts that aren't a
// subdomain of BASE_DOMAIN (localhost, previews) fall back to the usual
// localStorage / env resolution (see config.ts).
//
// A holon can also be picked by URL *path* — `site.com/<holon id>` or
// `site.com/<registered label>` (see `holonForPath`) — which wins over the
// subdomain, so one host can still deep-link any holon.

/** Base domain the kiosk is served under; subdomains of it select a holon. */
export const BASE_DOMAIN = "hubs.network";

/**
 * Map of subdomain label → holon id. Add one line per registered holon.
 * (Holon ids are the negative chat-id strings, e.g. "-1001234567890".)
 */
export const SUBDOMAIN_HOLONS: Record<string, string> = {
  residence: "-1001652773351",
  lauro: "-1001652773351",
  liminal: "-1003864542239",
  akasha: "-1003958094547",
  casaselva: "-1002964866719",
  refactory: "-1003943146280",
  civic: "-5349529224",
  lunation80: "-1003711659317",
};

/**
 * The holon-selecting subdomain label of a host, or null when the host is not a
 * subdomain of BASE_DOMAIN. The label is the one attached directly to the base
 * domain, so `staging.liminal.hubs.network` and `liminal.hubs.network` both
 * resolve to "liminal".
 */
export function subdomainOf(host: string): string | null {
  const h = host.toLowerCase().replace(/:\d+$/, ""); // strip any :port
  if (!h.endsWith("." + BASE_DOMAIN)) return null;
  const sub = h.slice(0, -(BASE_DOMAIN.length + 1));
  return sub.split(".").pop() || null;
}

/** The holon id mapped to a host's subdomain, or null if none is registered. */
export function holonForHost(host: string): string | null {
  const sub = subdomainOf(host);
  if (!sub) return null;
  const id = SUBDOMAIN_HOLONS[sub];
  return id && id.trim() ? id : null;
}

/**
 * The holon selected by the URL path, or null when the path doesn't name one.
 * `site.com/-1001234567890` shows that holon directly; `site.com/liminal`
 * resolves a registered label from SUBDOMAIN_HOLONS. Only the first segment is
 * considered (matching the `[[holon]]` route), and `/api/...` is never a holon.
 */
export function holonForPath(pathname: string): string | null {
  const seg = decodeURIComponent(
    pathname.replace(/^\/+/, "").split("/")[0] ?? "",
  ).trim();
  if (!seg || seg.toLowerCase() === "api") return null;
  const byLabel = SUBDOMAIN_HOLONS[seg.toLowerCase()];
  if (byLabel && byLabel.trim()) return byLabel;
  // Holon ids: group chat ids ("-100…") or personal numeric ids.
  return /^-?\d+$/.test(seg) ? seg : null;
}
