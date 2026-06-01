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

/** Base domain the kiosk is served under; subdomains of it select a holon. */
export const BASE_DOMAIN = "hubs.network";

/**
 * Map of subdomain label → holon id. Add one line per registered holon.
 * (Holon ids are the negative chat-id strings, e.g. "-1001234567890".)
 */
export const SUBDOMAIN_HOLONS: Record<string, string> = {
  liminal: "-1001652773351",
  casaselva: "-1002964866719",
  refactory: "-1003943146280",
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
