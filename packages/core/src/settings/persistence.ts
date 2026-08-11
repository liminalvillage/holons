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
