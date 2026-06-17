// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Turn a plain-text string into HTML where bare `http(s)://…` URLs become
 * new-tab anchors and everything else is HTML-escaped verbatim. The input is
 * never interpreted as HTML, so a description like "use <Foo> — see
 * https://x.org" keeps its angle brackets. The result is safe to drop into a
 * Svelte `{@html …}` block.
 *
 * Mirrors the linkify policy in apps/web (`lib/util/richContent.ts`): trailing
 * sentence punctuation (`.,;:!?)`) is kept out of the link so "see
 * https://x.org." doesn't swallow the period. The kiosk has no DOMPurify
 * dependency, so this stays a pure string transform — which also keeps it
 * SSR-safe (no DOM required).
 */

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

// A bare http/https URL. The lookahead drops trailing sentence punctuation so
// it isn't pulled into the link; the character class stops the URL at
// whitespace and `<>"` (which an escaped attribute/text context can't contain).
const URL_RE = /(https?:\/\/[^\s<>"]+?)(?=[.,;:!?)]?(?:\s|$))/g;

export function linkify(text: string | null | undefined): string {
  if (!text || typeof text !== "string") return "";

  let out = "";
  let cursor = 0;
  URL_RE.lastIndex = 0;
  let match = URL_RE.exec(text);
  while (match) {
    const url = match[1];
    out += escapeHtml(text.slice(cursor, match.index));
    const safe = escapeHtml(url);
    out += `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
    cursor = match.index + url.length;
    match = URL_RE.exec(text);
  }
  out += escapeHtml(text.slice(cursor));
  return out;
}
