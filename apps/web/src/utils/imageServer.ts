// Magic base64 prefixes for the image formats Telegram / the dashboard store.
const B64_SIGNATURES: ReadonlyArray<readonly [string, string]> = [
  ["/9j/", "image/jpeg"],
  ["iVBORw0KGg", "image/png"],
  ["R0lGOD", "image/gif"],
  ["UklGR", "image/webp"], // "RIFF…WEBP"
  ["PHN2Zw", "image/svg+xml"], // "<svg"
  ["PD94bWw", "image/svg+xml"], // "<?xml"
];

/** If `s` looks like a raw base64 image payload, return its mime; else null. */
function base64ImageMime(s: string): string | null {
  for (const [prefix, mime] of B64_SIGNATURES) {
    if (s.startsWith(prefix)) return mime;
  }
  // A long, purely-base64 blob is an image, not a (short) Telegram file_id.
  if (s.length > 256 && /^[A-Za-z0-9+/=_-]+$/.test(s)) return "image/jpeg";
  return null;
}

/**
 * Resolve a `picture` value to a displayable URL:
 *   - already a usable URL / data-URI / blob / absolute path → used as-is
 *   - raw base64 image payload (no `data:` prefix) → inlined as a data-URI
 *   - otherwise → treated as a Telegram file_id, resolved by our own
 *     /api/image route through the Bot API getFile (the old external
 *     telegram.holons.io/getimage server hid failures behind a 1×1 pixel)
 */
export function resolveImage(src: string | null | undefined): string {
  if (!src) return "";
  const s = src.trim();
  if (/^(https?:|data:|blob:|\/)/i.test(s)) return s;
  const clean = s.replace(/\s+/g, "");
  const mime = base64ImageMime(clean);
  if (mime) return `data:${mime};base64,${clean}`;
  return `/api/image?file_id=${encodeURIComponent(s)}`;
}
