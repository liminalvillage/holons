// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A holon's identity colour — the ONE algorithm every surface tints a holon
// with: the glow edge of a card mirrored from it, the faint wash over its own
// board, its orb in the kiosk dock, its hexagon on the map. It is the same
// hash-into-a-palette step the kiosk colours its post-it cards with (a task by
// its category, a role by its title): stable across devices and sessions with
// no configuration. A caretaker can override it with a `color` field on the
// holon's settings document, and every surface follows the override.

/** Settings field holding the caretaker-chosen colour (`#rrggbb`). */
export const COLOR_KEY = 'color';

/**
 * The card hash: a non-negative integer for a seed string. Empty seeds hash
 * as "•" so a blank category still lands on a colour. Exposed for callers that
 * want a stable per-holon number (a drift phase, a tilt) rather than a colour.
 */
export function colorHash(seed: string | undefined): number {
  const s = seed && seed.length ? String(seed) : '•';
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash << 5) - hash + s.charCodeAt(i);
  return Math.abs(hash);
}

/**
 * Pick a colour for a seed from a palette — the way the kiosk picks a post-it
 * colour for a category — unless a valid override is given. `override` may be
 * a colour string or a settings document carrying `color`.
 */
export function pickColor(
  seed: string | undefined,
  palette: readonly string[],
  override?: unknown,
): string {
  const chosen =
    typeof override === 'string' ? normalizeHolonColor(override) : readHolonColor(override);
  if (chosen) return chosen;
  if (palette.length === 0) return '';
  return palette[colorHash(seed) % palette.length];
}

/**
 * The colour a holon is drawn with: the caretaker override when one is set,
 * else the palette entry its id hashes to. Every surface goes through here so
 * they cannot disagree.
 */
export function holonColor(
  id: string,
  palette: readonly string[],
  override?: unknown,
): string {
  return pickColor(id, palette, override);
}

/**
 * Normalise a colour to lowercase `#rrggbb`, or '' when it is not a plain hex
 * colour. Only hex is accepted: it is what colour pickers emit and what map
 * renderers and CSS both take verbatim, and the settings document must never
 * carry an arbitrary CSS string.
 */
export function normalizeHolonColor(input: unknown): string {
  const raw = String(input ?? '').trim().toLowerCase();
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(raw);
  if (!m) return '';
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return `#${hex}`;
}

/**
 * The caretaker override on a settings document, or '' when none is set.
 * Tolerates the array shape some holospheres hand back for the settings lens.
 */
export function readHolonColor(settings: unknown): string {
  if (Array.isArray(settings)) {
    for (const entry of settings) {
      const c = readHolonColor(entry);
      if (c) return c;
    }
    return '';
  }
  const doc = (settings ?? {}) as Record<string, unknown>;
  return normalizeHolonColor(doc[COLOR_KEY]);
}

/**
 * Set (or, with '', clear) a holon's colour override. Merges over the existing
 * settings document, like the other per-field settings writers. Returns the
 * colour as stored so the caller can show what actually landed.
 */
export async function saveHolonColor(
  holosphere: any,
  holonId: string,
  color: string,
): Promise<string> {
  const clean = normalizeHolonColor(color);

  let existing: any = null;
  try {
    existing = await holosphere.get(String(holonId), 'settings', String(holonId));
  } catch {
    // A failed read must not cost the caretaker their edit: fall back to a
    // settings document carrying the colour alone.
  }

  await holosphere.put(String(holonId), 'settings', {
    ...(existing ?? {}),
    id: String(holonId),
    [COLOR_KEY]: clean,
  });

  return clean;
}
