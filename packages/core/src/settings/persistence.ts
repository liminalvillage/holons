// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings persistence primitives, extracted from flow-settings.ts so that
// federation-links.ts and the FlowSettings class can both build on them
// without importing each other (flow-settings → federation-links → here).

import type { HoloSphere } from 'holosphere';
import type { HolonSettings } from './flow-settings.js';

/**
 * Default `HolonSettings` skeleton used when nothing is persisted yet.
 *
 * Kept as a standalone helper (rather than baked into the class) so that
 * non-class callers — including the Telegram bot — can use it without
 * instantiating `FlowSettings`.
 */
export function getDefaultHolonSettings(holonId: string): HolonSettings {
  return {
    id: holonId,
    name: `Holon ${holonId}`,
    version: 1,
    admin: '',
    timezone: 'UTC',
    language: 'en',
    theme: 'dark',
    // H3 cell address — empty until the holon picks one (Settings → Hex
    // Address). A CSS color used to be the accidental default here; see
    // readSettingsHex, which filters legacy persisted values.
    hex: '',
    maxTasks: 10,
    flowManagement: {
      internalPercent: 50,
      externalPercent: 50,
      autoBalance: false,
      thresholds: {
        minInternal: 10,
        maxInternal: 90
      }
    },
    created: new Date().toISOString()
  };
}

/**
 * Parses raw holosphere settings data into a populated `HolonSettings`
 * with sane defaults for any missing fields.
 */
export function parseHolonSettings(data: any): HolonSettings {
  return {
    id: data.id || '',
    name: data.name || '',
    version: data.version || 1,
    admin: data.admin || '',
    timezone: data.timezone || 'UTC',
    language: data.language || 'en',
    theme: data.theme || 'dark',
    hex: data.hex || '',
    maxTasks: data.maxTasks || 10,
    // Legacy `federation[]` / `lensConfig` settings-lens fields are NOT parsed
    // — the native federation record is the single store (see
    // migrateLegacyFederationLinks in @holons/core/federation).
    flowManagement: data.flowManagement || {
      internalPercent: 50,
      externalPercent: 50,
      autoBalance: false,
      thresholds: { minInternal: 10, maxInternal: 90 }
    },
    // Canonical `created` (ISO). Promote legacy `timestamp` (ms epoch) for
    // records written before the unify.
    created: typeof data.created === 'string'
      ? data.created
      : (typeof data.timestamp === 'number' ? new Date(data.timestamp).toISOString() : new Date().toISOString())
  };
}

/**
 * Loads raw settings for a holon from holosphere.
 *
 * Returns the persisted object as-is (or `null` if nothing is stored).
 * Callers that want a normalised `HolonSettings` should pipe the result
 * through `parseHolonSettings`.
 */
export async function loadSettings(
  holosphere: HoloSphere,
  holonId: string
): Promise<any | null> {
  try {
    const data = await holosphere.get(String(holonId), 'settings', String(holonId));
    return data ?? null;
  } catch (error) {
    console.error('Error loading holon settings:', error);
    return null;
  }
}

/**
 * Fields that mark a record as an actual holon settings document.
 *
 * The settings lens is not guaranteed to hold exactly one record: some writers
 * deliberately key a second one (CalendarSettings stores `imported_calendars`),
 * and historically several wrote with no `id` at all, which makes
 * `ContentOps.put` mint a random key. So "the settings doc" cannot be found by
 * position.
 */
const SETTINGS_MARKERS = [
  'name',
  'language',
  'timezone',
  'theme',
  'valueEquation',
  'currencies',
  'purpose',
  'maxTasks',
  'hex',
  'admin',
] as const;

/** How many settings-ish fields a record carries. */
function settingsAffinity(record: unknown): number {
  const doc = (record ?? {}) as Record<string, unknown>;
  let score = 0;
  for (const key of SETTINGS_MARKERS) {
    if (doc[key] !== undefined && doc[key] !== null && doc[key] !== '') score++;
  }
  return score;
}

/**
 * Read a holon's settings document, safely.
 *
 * Prefer this over `getAll(holonId, 'settings')[0]`. That idiom is common in
 * this repo and it is a bug: Gun's map iteration has no defined order, so index
 * 0 is whichever record happened to arrive first. On a holon that has imported
 * a calendar, index 0 can be the `imported_calendars` record — and a caller
 * that then spreads it and saves it back copies calendar data into the holon's
 * settings while losing its name, language and value equation.
 *
 * The lookup goes canonical-first:
 *
 *  1. the record keyed by the holon id — the only correct home, and where every
 *     fixed writer now puts it;
 *  2. failing that, a record in the lens whose own `id` matches (covers a keyed
 *     write that has not replicated into the keyed read yet);
 *  3. failing that, the orphan that most looks like a settings document.
 *
 * Step 3 is what keeps this from being a regression: holons whose name was
 * written by one of the id-less writers have it in a randomly-keyed orphan and
 * nothing under the canonical key, so a strict keyed read would blank them.
 * Records carrying no settings markers at all (a lone `bundle`, a lone
 * `federationZones`, `imported_calendars`) score zero and are never returned.
 */
export async function readHolonSettings(
  holosphere: HoloSphere,
  holonId: string
): Promise<any | null> {
  const id = String(holonId ?? '').trim();
  if (!id) return null;

  try {
    const keyed = await holosphere.get(id, 'settings', id);
    if (keyed) return keyed;
  } catch {
    // Fall through to the scan; a keyed-read failure is not proof of absence.
  }

  let records: any[] = [];
  try {
    records = (await (holosphere as any).getAll(id, 'settings')) ?? [];
  } catch {
    return null;
  }
  if (!Array.isArray(records) || records.length === 0) return null;

  const own = records.find((r) => r && String(r.id ?? '') === id);
  if (own) return own;

  const best = records
    .map((r) => ({ record: r, affinity: settingsAffinity(r) }))
    .filter((c) => c.affinity > 0)
    .sort((a, b) => b.affinity - a.affinity)[0];

  return best?.record ?? null;
}

/**
 * Saves raw settings for a holon to holosphere.
 *
 * Accepts any settings shape (web `HolonSettings`, telegram bot settings,
 * partials, etc.) so the same primitive serves all surfaces.
 */
export async function saveSettings(
  holosphere: HoloSphere,
  holonId: string,
  settings: any
): Promise<void> {
  await holosphere.put(String(holonId), 'settings', settings);
}
