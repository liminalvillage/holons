// Resolve a quest/thing `picture` to a displayable URL.
//   - already a usable URL / data-URI / blob / absolute path → used as-is
//   - raw base64 image payload (no `data:` prefix) → inlined as a data-URI
//   - anything else → treated as a Telegram file_id, fetched via the bot's
//     image server.
const PROD_HOST = "https://telegram.holons.io";
const DEV_HOST = "http://localhost:8080";

export function imageServerBase(): string {
  if (typeof window === "undefined") return PROD_HOST;
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return DEV_HOST;
  return PROD_HOST;
}

// Magic base64 prefixes for the formats Telegram/the dashboard actually store.
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
  // Fallback: a long, purely-base64 blob is an image, not a (short) file_id.
  if (s.length > 256 && /^[A-Za-z0-9+/=_-]+$/.test(s)) return "image/jpeg";
  return null;
}

export function resolveImage(src: string | null | undefined): string {
  if (!src) return "";
  const s = src.trim();
  if (/^(https?:|data:|blob:|\/)/i.test(s)) return s;
  const clean = s.replace(/\s+/g, "");
  const mime = base64ImageMime(clean);
  if (mime) return `data:${mime};base64,${clean}`;
  return `${imageServerBase()}/getimage?file_id=${encodeURIComponent(s)}`;
}
