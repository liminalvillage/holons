// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Subdomain → holon registry. ONE kiosk deploy can serve every registered
// holon: the host's subdomain under the base domain selects which holon the
// screen shows, e.g.
//
//   liminal.hubs.network        → "liminal" → <holon id>
//   www.liminal.hubs.network    → "liminal" → <holon id>
//
// Point a wildcard domain (`*.hubs.network`) at the one Netlify site. A holon
// needs NO entry below to be reachable: an undeclared subdomain is read as the
// holon id itself (`1003864542239.hubs.network`, see `holonForHost`). Adding an
// entry is how a holon earns a *name* instead — and a declared mapping always
// wins. A `?holon=<id>` query param still overrides both (for testing), and
// hosts that aren't a subdomain of BASE_DOMAIN (localhost, previews) fall back
// to the usual localStorage / env resolution (see config.ts).
//
// A holon can also be picked by URL *path* — `site.com/<holon id>` or
// `site.com/<registered label>` (see `holonForPath`) — which wins over the
// subdomain, so one host can still deep-link any holon.

/** Base domain the kiosk is served under; subdomains of it select a holon. */
export const BASE_DOMAIN = "hubs.network";

/**
 * Map of subdomain label → holon id: the holons that have earned a NAME.
 * (Holon ids are the negative chat-id strings, e.g. "-1001234567890".)
 * Optional — an unlisted holon is still reachable at `<id>.hubs.network` —
 * but an entry here takes precedence over that fall-through.
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
  armoniaduale: "-1004310409791",
  commons: "-5459621960",
  valley: "-5459621960",
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

/**
 * Subdomain labels that are infrastructure, not holons. Without this, the
 * fall-through below would turn `www.hubs.network` into a board for a holon
 * called "www" instead of serving the home page.
 */
const RESERVED_SUBDOMAINS = new Set([
  "www",
  "api",
  "app",
  "admin",
  "dev",
  "docs",
  "mail",
  "preview",
  "staging",
  "test",
]);

/**
 * The holon a host's subdomain selects, or null when the host doesn't name one.
 *
 * A declared mapping in SUBDOMAIN_HOLONS always wins — that is what gives a hub
 * a memorable name. Anything else falls through as the holon id ITSELF, so a
 * new holon is reachable at `<id>.hubs.network` without a code change or a
 * redeploy. Because DNS labels cannot begin with "-", a Telegram supergroup id
 * is written without it (`1003864542239.hubs.network`) and the sign is restored
 * here; every other label is taken verbatim.
 */
export function holonForHost(host: string): string | null {
  const sub = subdomainOf(host);
  if (!sub) return null;
  const declared = SUBDOMAIN_HOLONS[sub];
  if (declared && declared.trim()) return declared;
  if (RESERVED_SUBDOMAINS.has(sub)) return null;
  return holonIdFromLabel(sub);
}

/**
 * A DNS label read as a holon id. Telegram group ids are "-100" + 10 digits and
 * a hostname can't carry that leading "-", so a label of exactly that shape
 * gets it back. Shorter numeric labels (personal holons are a plain user id)
 * and non-numeric ones are their own id, unchanged.
 */
function holonIdFromLabel(label: string): string | null {
  if (/^100\d{10}$/.test(label)) return `-${label}`;
  return /^[a-z0-9][a-z0-9-]*$/.test(label) ? label : null;
}

/**
 * The holon selected by the URL path, or null when the path doesn't name one.
 * `site.com/-1001234567890` shows that holon directly; `site.com/liminal`
 * resolves a registered label from SUBDOMAIN_HOLONS. Only the first segment is
 * considered (the first half of the `[[holon]]/[[tab]]` route — the tab half
 * is tabroute.ts), and `/api/...` is never a holon.
 */
export function holonForPath(pathname: string): string | null {
  const seg = decodeURIComponent(
    pathname.replace(/^\/+/, "").split("/")[0] ?? "",
  ).trim();
  if (!seg || seg.toLowerCase() === "api") return null;
  return holonForToken(seg);
}

/**
 * A token that IS an identity — an Ethereum address or a Nostr npub. A holon
 * can be keyed by any of a person's identities, not only a Telegram id, and
 * these shapes are unambiguous (no tab id, registered label, or ordinary word
 * looks like them), so they are honoured anywhere a holon id is. Normalised
 * to lowercase so the same identity always names the same holon namespace
 * (Ethereum addresses circulate in mixed checksum case).
 */
function identityToken(token: string): string | null {
  const tok = token.trim();
  if (/^0x[0-9a-f]{40}$/i.test(tok)) return tok.toLowerCase();
  if (/^npub1[02-9ac-hj-np-z]{58}$/i.test(tok)) return tok.toLowerCase();
  return null;
}

/**
 * The holon a token names, or null. A token is either a registered label
 * ("liminal"), an identity (an Ethereum address or an npub), or a raw holon
 * id — a group chat id ("-100…") or a personal numeric id. Same rules
 * `holonForPath` applies to a URL segment. A registered label wins over
 * everything, so a name always resolves to its holon id.
 */
function holonForToken(token: string): string | null {
  const tok = token.trim();
  if (!tok) return null;
  const byLabel = SUBDOMAIN_HOLONS[tok.toLowerCase()];
  if (byLabel && byLabel.trim()) return byLabel;
  const identity = identityToken(tok);
  if (identity) return identity;
  return /^-?\d+$/.test(tok) ? tok : null;
}

/** Parse `raw` as a URL, tolerating a missing scheme ("liminal.hubs.network"). */
function asUrl(raw: string): URL | null {
  for (const candidate of [raw, `https://${raw}`]) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return url;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

/**
 * The holon id a person pasted, whatever shape they had to hand — the one
 * thing the landing page asks for when someone comes back from the bot.
 * Accepts, in order of what people actually copy:
 *
 *   -1001234567890                       a holon id straight from the bot
 *   liminal                              a registered label
 *   0x52908400098527886e0f7030069857d…   an Ethereum address
 *   npub1…                               a Nostr public key
 *   This holon ID is -1001234567890      the whole `/id` reply, pasted
 *   https://t.me/c/1234567890/42         "Copy link" on a message in the group
 *   https://dashboard.holons.io/-100…    what `/dashboard` replies with
 *   https://liminal.hubs.network         a hub's own screen
 *   https://hubs.network/-100…           this kiosk, deep-linked
 *
 * Returns null when nothing in the input names a holon (a public `t.me/<name>`
 * link, for instance, carries a username the chat id can't be derived from).
 */
export function parseHolonRef(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  // A bare id or label — the common case, and unambiguous.
  const direct = holonForToken(raw);
  if (direct) return direct;

  const url = asUrl(raw);
  if (!url) return null;
  const segments = url.pathname
    .split("/")
    .map((s) => decodeURIComponent(s).trim())
    .filter(Boolean);

  // Telegram's private-supergroup links drop the "-100" prefix that every
  // chat id carries, so `t.me/c/1234567890/42` is holon "-1001234567890".
  if (url.hostname.replace(/^www\./, "") === "t.me") {
    if (segments[0] === "c" && /^\d+$/.test(segments[1] ?? ""))
      return `-100${segments[1]}`;
    return null; // t.me/<username> names a chat we can't resolve to an id
  }

  // A registered subdomain (liminal.hubs.network) names its holon outright.
  const bySubdomain = holonForHost(url.hostname);
  if (bySubdomain) return bySubdomain;

  // Otherwise the id/label sits in the path — dashboard.holons.io/<id>,
  // hubs.network/<id>, a preview host, anything shaped that way.
  for (const seg of segments) {
    const id = holonForToken(seg);
    if (id) return id;
  }
  return null;
}

/**
 * Ids the way people actually arrive with them: not typed, but pasted whole
 * out of Telegram. The landing page tells them to run `/id`, and the reply is
 * a sentence — "This holon ID is -1001234567890" — so the field has to read an
 * id out of prose as well as on its own.
 *
 * Only a Telegram chat id counts here: `-100`-prefixed, or a bare run of
 * digits long enough to be a user id. A stray "42" in a sentence is not an
 * id, and a registered label ("liminal") is only honoured as the whole input,
 * where `parseHolonRef` already resolves it — picking words out of prose and
 * hoping one is a label would fire on any sentence containing that word.
 */
const ID_IN_TEXT = /(?:^|[^\d-])(-100\d{6,}|-?\d{6,})(?![\d])/;

/**
 * `parseHolonRef`, plus a last pass that finds an id embedded in pasted text.
 * Kept separate so the strict parse stays available (and testable) on its own.
 */
export function parseHolonPaste(input: string): string | null {
  const strict = parseHolonRef(input);
  if (strict) return strict;

  const raw = (input ?? "").trim();
  // A pasted line can carry a LINK with the id in it as easily as a bare
  // number, so retry each link-shaped token on its own. Link-shaped ONLY:
  // handing every word to parseHolonRef would let a sentence that merely
  // mentions a hub's name ("we met the liminal crew") redirect the screen.
  for (const token of raw.split(/\s+/)) {
    const clean = token.replace(/^[(<\[]+|[)>\].,;:!?]+$/g, "");
    // An identity token (0x…, npub1…) in the middle of a sentence still names
    // its holon — and it must be caught HERE, before ID_IN_TEXT below plucks a
    // run of digits out of the middle of the address.
    const identity = identityToken(clean);
    if (identity) return identity;
    if (!/^(https?:\/\/|[\w-]+(\.[\w-]+)+\/)/i.test(clean)) continue;
    const id = parseHolonRef(clean);
    if (id) return id;
  }
  const m = ID_IN_TEXT.exec(raw);
  return m ? m[1] : null;
}

/**
 * What the dock's add form accepts: everything `parseHolonPaste` does, plus
 * ANY bare alphanumeric token taken verbatim as a holon id. A registered
 * label ("liminal") still resolves to its holon id first, and identities
 * (Telegram ids, Ethereum addresses, npubs) keep their normalised forms —
 * only a token nothing else recognises falls through unchanged. The fallback
 * lives here and not in `holonForToken`, where it would turn any word in a
 * URL path or pasted sentence into a holon.
 */
export function parseHolonAdd(input: string): string | null {
  const known = parseHolonPaste(input);
  if (known) return known;
  const tok = (input ?? "").trim();
  return /^[a-z0-9][a-z0-9_-]*$/i.test(tok) ? tok : null;
}
