// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// What an identifier is, and the one short form every surface shows when
// nothing names it. Holons has three id shapes: a Telegram user id (digits),
// a holon id (a negative chat id, `holon_…`, `hub_…`, `chat_…`) and a Nostr
// key (64 hex or `npub1…`), which may be a person OR a key-founded holon —
// the resolver decides by what the sources say.

import * as nip19 from 'nostr-tools/nip19';

const HEX64 = /^[0-9a-f]{64}$/;
const NPUB = /^npub1[02-9ac-hj-np-z]+$/i;
const HOLONISH = /^(-\d+|(holon|hub|chat)_[a-z0-9_-]+)$/i;

export type IdKind = 'person' | 'holon' | 'key';

/** Hex or npub → lowercase 64-hex; anything else → its trimmed string form. */
export function normalizeId(id: string | number | null | undefined): string {
  const raw = String(id ?? '').trim().replace(/^nostr:/i, '');
  if (!raw) return '';
  if (HEX64.test(raw.toLowerCase())) return raw.toLowerCase();
  if (NPUB.test(raw)) {
    try {
      const d = nip19.decode(raw.toLowerCase());
      if (d.type === 'npub') return d.data;
    } catch {
      /* not a valid npub: keep the text */
    }
  }
  return raw;
}

/** Whether `id` (hex or npub) is a Nostr key. */
export function isKeyId(id: string | number | null | undefined): boolean {
  return HEX64.test(normalizeId(id));
}

/** Digits → person; negative digits or a holon/hub/chat prefix → holon; a key → key. */
export function idKind(id: string | number | null | undefined): IdKind {
  const n = normalizeId(id);
  if (HEX64.test(n)) return 'key';
  if (/^\d+$/.test(n)) return 'person';
  if (HOLONISH.test(n)) return 'holon';
  return 'holon';
}

/**
 * The short form shown when no name is known: a key as `npub1abcdefgh…xyz123`,
 * a Telegram id as `#235114395`, any other id as itself. Replaces every
 * ad-hoc `slice(0, 8)`.
 */
export function shortId(id: string | number | null | undefined): string {
  const n = normalizeId(id);
  if (!n) return '';
  if (HEX64.test(n)) {
    const npub = nip19.npubEncode(n);
    return `${npub.slice(0, 13)}…${npub.slice(-6)}`;
  }
  if (/^\d+$/.test(n)) return `#${n}`;
  return n;
}

/**
 * Whether `name` is only a stand-in for `id` — its npub (whole, shortened,
 * with either ellipsis) or a hex prefix — and so must never be persisted as
 * a person's name.
 */
export function isPlaceholderName(name: unknown, id: string | number | null | undefined): boolean {
  const s = String(name ?? '').trim();
  if (!s) return true;
  const n = normalizeId(id);
  if (s === shortId(n) || s === `#${n}` || s === n) return true;
  if (HEX64.test(n)) {
    const npub = nip19.npubEncode(n);
    if (s.toLowerCase() === npub) return true;
    const compact = s.replace(/\s|…|\.{3}/g, '').toLowerCase();
    if (compact.length >= 8 && npub.startsWith(compact.slice(0, 8)) && npub.endsWith(compact.slice(-4))) return true;
    if (/^[0-9a-f]{8,}$/.test(compact) && n.startsWith(compact.slice(0, 8))) return true;
  }
  return /^npub1[02-9ac-hj-np-z]{4,}(…|\.{3})?[02-9ac-hj-np-z]*$/i.test(s);
}

/** Display text from an untrusted source: no control characters, trimmed, capped. */
export function cleanName(value: unknown, max = 64): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
