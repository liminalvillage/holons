// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// What a stored `picture` is, and how any surface turns it into something
// to show. One rule for every UI (the kiosk and the web used to carry
// byte-identical copies of it).
//
// A picture is one of:
//   - a hosted URL (Blossom or any https image) — shown as-is everywhere;
//   - a data: URI or raw base64 payload — legacy web uploads, inlined;
//   - a Telegram file_id — opens only with the receiving bot's token, so it
//     goes through the app's own `/api/image` route.

/** Magic base64 prefixes for the image formats Telegram / the dashboard store. */
const B64_SIGNATURES: ReadonlyArray<readonly [string, string]> = [
  ['/9j/', 'image/jpeg'],
  ['iVBORw0KGg', 'image/png'],
  ['R0lGOD', 'image/gif'],
  ['UklGR', 'image/webp'], // "RIFF…WEBP"
  ['PHN2Zw', 'image/svg+xml'], // "<svg"
  ['PD94bWw', 'image/svg+xml'], // "<?xml"
];

export type PictureSource =
  | { kind: 'url'; url: string }
  | { kind: 'inline'; url: string }
  | { kind: 'telegram'; fileId: string };

/** If `s` looks like a raw base64 image payload, return its mime; else null. */
function base64ImageMime(s: string): string | null {
  for (const [prefix, mime] of B64_SIGNATURES) {
    if (s.startsWith(prefix)) return mime;
  }
  // A long, purely-base64 blob is an image, not a (short) Telegram file_id.
  if (s.length > 256 && /^[A-Za-z0-9+/=_-]+$/.test(s)) return 'image/jpeg';
  return null;
}

/** Classify a stored picture value; null when there is none. */
export function pictureSource(value: unknown): PictureSource | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  if (/^data:/i.test(s)) return { kind: 'inline', url: s };
  // Raw base64 before paths: a JPEG payload starts with "/9j/".
  const clean = s.replace(/\s+/g, '');
  const mime = base64ImageMime(clean);
  if (mime) return { kind: 'inline', url: `data:${mime};base64,${clean}` };
  if (/^(https?:|blob:|\/)/i.test(s)) return { kind: 'url', url: s };
  return { kind: 'telegram', fileId: s };
}

/** Whether a picture is a hosted http(s) URL — readable by anyone, anywhere. */
export function isHostedPicture(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

/**
 * A displayable URL for a stored picture ('' when there is none). Telegram
 * file_ids resolve through the app's own image route.
 */
export function pictureUrl(value: unknown, opts: { imageRoute?: string } = {}): string {
  const src = pictureSource(value);
  if (!src) return '';
  if (src.kind === 'telegram') return `${opts.imageRoute ?? '/api/image'}?file_id=${encodeURIComponent(src.fileId)}`;
  return src.url;
}
