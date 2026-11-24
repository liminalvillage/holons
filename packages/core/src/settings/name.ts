// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A holon's name — the `name` field on its settings document, which is where
// every surface's name resolver reads it (`@holons/core/identity`). A holon
// is renamed here and nowhere else; its id never changes.

import { cleanName, isPlaceholderName } from '../identity/ids.js';

/** Settings field holding the holon's name. */
export const NAME_KEY = 'name';

/**
 * A name as it may be stored: control characters out, whitespace collapsed,
 * capped — or '' when what is left is no name at all (blank, the holon's own
 * id, or one of the stand-ins a writer puts down when it knows none).
 */
export function normalizeHolonName(input: unknown, holonId: string | number): string {
  const name = cleanName(input);
  return name && !isPlaceholderName(name, holonId) ? name : '';
}

/**
 * Rename a holon. Merges over the existing settings document, like the other
 * per-field settings writers, and returns the name as stored. A holon cannot
 * be un-named: an input that is no name writes nothing and returns ''.
 */
export async function saveHolonName(
  holosphere: any,
  holonId: string,
  name: string,
): Promise<string> {
  const clean = normalizeHolonName(name, holonId);
  if (!clean) return '';

  let existing: any = null;
  try {
    existing = await holosphere.get(String(holonId), 'settings', String(holonId));
  } catch {
    // A failed read must not cost the caretaker their edit: fall back to a
    // settings document carrying the name alone.
  }

  await holosphere.put(String(holonId), 'settings', {
    ...(existing ?? {}),
    id: String(holonId),
    [NAME_KEY]: clean,
  });

  return clean;
}
