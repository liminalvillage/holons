// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The URL grammar. Every party has one address, and it can be shared:
//
//   /p/<party>     a person, or a seat nobody has claimed yet
//   /h/<holon>     a fund, a project, the Pot
//   /a/<0x…>       whoever is paid at an address
//   /eco           the whole map (`?view=diagram`: as a Sankey, not in space)
//   /search?q=     by name
//
// `?unit=` (amounts instead of shares) and `?up=` (how far back provenance is
// drawn) ride along from one party to the next. Pure.

import type { FlowPartyKind } from "@holons/core/flows";

/** The view state that follows the reader from one party to the next. */
const CARRIED = ["unit", "up"] as const;

/** Which of the two party routes a kind lives under. */
export function routeOf(kind: FlowPartyKind): "p" | "h" {
  return kind === "person" || kind === "placeholder" ? "p" : "h";
}

function carry(from?: URLSearchParams | null): string {
  if (!from) return "";
  const out = new URLSearchParams();
  for (const key of CARRIED) {
    const value = from.get(key);
    if (value) out.set(key, value);
  }
  const text = out.toString();
  return text ? `?${text}` : "";
}

/** The address of a party. */
export function hrefFor(
  party: { id: string; kind: FlowPartyKind },
  from?: URLSearchParams | null,
): string {
  return `/${routeOf(party.kind)}/${encodeURIComponent(party.id)}${carry(from)}`;
}

export function addressHref(address: string): string {
  return `/a/${encodeURIComponent(address.trim().toLowerCase())}`;
}

export function searchHref(query: string, kind?: FlowPartyKind): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (kind) params.set("kind", kind);
  const text = params.toString();
  return text ? `/search?${text}` : "/search";
}

/** A URL with one view parameter set (or, with null, dropped). */
export function withParam(url: URL, key: string, value: string | null): string {
  const next = new URL(url);
  if (value == null || value === "") next.searchParams.delete(key);
  else next.searchParams.set(key, value);
  return `${next.pathname}${next.search}`;
}

export type Target =
  | { type: "address"; value: string }
  | { type: "id"; value: string }
  | { type: "query"; value: string };

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const IDISH =
  /^(npub1[02-9ac-hj-np-z]+|[0-9a-f]{64}|-?\d{5,}|(holon|hub|chat)_[a-z0-9_-]+|[a-z][a-z0-9_-]*:\S+)$/i;

/** What someone pasted into the box: an address, an id, or words to search. */
export function parseTarget(input: string): Target | null {
  const text = String(input ?? "").trim();
  if (!text) return null;
  if (ADDRESS.test(text)) return { type: "address", value: text.toLowerCase() };
  if (IDISH.test(text) && !/^https?:/i.test(text))
    return { type: "id", value: text };
  return { type: "query", value: text };
}
