// Federation link helpers shared by all UIs.
//
// `applyAddFederationLink` / `applyRemoveFederationLink` are pure mutators —
// they update a settings object in place and return it, with no I/O. The
// `addFederationLink` / `removeFederationLink` wrappers add load+save so
// stateless callers (bot, scripts) get a one-shot persistent operation.
// The `FlowSettings` class reuses the same pure mutators to keep its
// in-memory cache and persisted state in lockstep with the standalones.

import type { HoloSphere } from 'holosphere';
import {
  type FederationLink,
  type HolonSettings,
  getDefaultHolonSettings,
  loadSettings,
  parseHolonSettings,
  saveSettings,
} from './flow-settings.js';

/**
 * Adds (or updates) a federation link on a settings object in place.
 *
 * Returns the same object so callers can chain.
 */
export function applyAddFederationLink(
  settings: HolonSettings,
  targetId: string,
  targetName: string,
  relationship: 'federated' | 'notifies'
): HolonSettings {
  const existingLink = settings.federation.find((f) => f.targetId === targetId);

  if (existingLink) {
    existingLink.relationship = relationship;
    existingLink.timestamp = Date.now();
  } else {
    const link: FederationLink = {
      targetId,
      targetName,
      relationship,
      lenses: { inbound: [], outbound: [] },
      timestamp: Date.now(),
    };
    settings.federation.push(link);
  }

  return settings;
}

/**
 * Removes a federation link (and its lens config) from a settings object
 * in place.
 */
export function applyRemoveFederationLink(
  settings: HolonSettings,
  targetId: string
): HolonSettings {
  settings.federation = settings.federation.filter((f) => f.targetId !== targetId);
  delete settings.lensConfig[targetId];
  return settings;
}

/**
 * Loads settings, applies an add-federation mutation, and persists the
 * result. Use this from stateless callers (bot commands, scripts).
 */
export async function addFederationLink(
  holosphere: HoloSphere,
  holonId: string,
  targetId: string,
  targetName: string,
  relationship: 'federated' | 'notifies'
): Promise<HolonSettings> {
  const raw = await loadSettings(holosphere, holonId);
  const settings: HolonSettings = raw
    ? parseHolonSettings(raw)
    : getDefaultHolonSettings(holonId);

  applyAddFederationLink(settings, targetId, targetName, relationship);
  settings.id = holonId;
  settings.timestamp = Date.now();
  await saveSettings(holosphere, holonId, settings);
  return settings;
}

/**
 * Loads settings, applies a remove-federation mutation, and persists the
 * result.
 */
export async function removeFederationLink(
  holosphere: HoloSphere,
  holonId: string,
  targetId: string
): Promise<HolonSettings> {
  const raw = await loadSettings(holosphere, holonId);
  const settings: HolonSettings = raw
    ? parseHolonSettings(raw)
    : getDefaultHolonSettings(holonId);

  applyRemoveFederationLink(settings, targetId);
  settings.id = holonId;
  settings.timestamp = Date.now();
  await saveSettings(holosphere, holonId, settings);
  return settings;
}
