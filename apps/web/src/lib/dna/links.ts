// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Where the dashboard's DNA pages point. There is one editor for a holon's
// DNA — the kiosk's, on hubs.network — so "Edit DNA" leaves for it.

/** The kiosk origin; overridable for a local kiosk (`VITE_HUBS_URL`). */
export const HUBS_ORIGIN: string = (
  (import.meta.env?.VITE_HUBS_URL as string | undefined) ||
  "https://hubs.network"
).replace(/\/+$/, "");

const seg = (holon: string): string => encodeURIComponent(holon);

export const dnaHref = (holon: string): string => `/${seg(holon)}/dna`;
export const applyHref = (holon: string): string => `/${seg(holon)}/apply`;
export const holonHref = (holon: string): string => `/${seg(holon)}`;
export const editDnaHref = (holon: string): string =>
  `${HUBS_ORIGIN}/${seg(holon)}/dna?edit`;

const SAFE_HREF =
  /^(https?:\/\/[^\s]+|mailto:[^\s]+|tg:\/\/[^\s]+|\/(?!\/)[^\s]*|#[^\s]*)$/i;

/**
 * A link a gene carries, when it is one this page may follow: http(s),
 * mailto:, tg://, a site path or an anchor. Core refuses anything else when
 * an admin writes it; this is the reader's own check (never a `javascript:`
 * link, whatever the relay hands over). Null when it is not.
 */
export function safeHref(href: string | undefined | null): string | null {
  const h = String(href ?? "").trim();
  return SAFE_HREF.test(h) ? h : null;
}

/** Whether a link leaves this site (opens in a new tab). */
export const isExternal = (href: string): boolean =>
  /^(https?:|tg:)/i.test(href);
