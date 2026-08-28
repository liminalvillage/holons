// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Per-holon Flows configuration on the settings lens.
 *
 * Both writers here follow `saveEquation`: read the existing settings document,
 * spread it, stamp `id`, then put. The stamp matters — it is what makes the
 * record collide with the bot's settings doc (read as
 * `get(holonId, 'settings', holonId)`) instead of forking a second one — and
 * the merge matters because `saveSettings` is a raw put that would otherwise
 * drop `name`, `hex`, `valueEquation` and `currencies` on the floor.
 */

import {
  DEFAULT_ALLOCATION_CONFIG,
  normalizeAllocationConfig,
  type AllocationConfig,
  type AllocationPartner,
} from './allocation.js';
import { normalizeCollectiveSlug } from './opencollective.js';

/** Settings field holding the OpenCollective link. */
export const COLLECTIVE_KEY = 'openCollective';

/** Settings field holding the off-chain allocation mirror. */
export const ALLOCATION_KEY = 'allocation';

/** Legacy field written by Flow Management's sync path. */
const LEGACY_ZONES_KEY = 'federationZones';

/** The holon's collective slug, or '' when unset. */
export function readCollectiveSlug(settings: unknown): string {
  const doc = (settings ?? {}) as Record<string, unknown>;
  const entry = doc[COLLECTIVE_KEY] as Record<string, unknown> | undefined;
  return normalizeCollectiveSlug(entry?.slug ?? '');
}

/**
 * Point a holon at an OpenCollective collective.
 *
 * Accepts a pasted collective URL as readily as a bare slug. Returns the slug
 * as stored, so callers can show what actually landed.
 */
export async function saveCollectiveSlug(
  holosphere: any,
  holonId: string,
  slug: string,
): Promise<string> {
  const clean = normalizeCollectiveSlug(slug);

  let existing: any = null;
  try {
    existing = await holosphere.get(String(holonId), 'settings', String(holonId));
  } catch {
    // A failed read must not cost the caretaker their edit: fall back to a
    // settings document carrying the slug alone.
  }

  await holosphere.put(String(holonId), 'settings', {
    ...(existing ?? {}),
    id: String(holonId),
    [COLLECTIVE_KEY]: { slug: clean },
  });

  return clean;
}

/**
 * The holon's allocation split, off-chain.
 *
 * Flow Management reads these from the deployed contract, which needs a wallet.
 * The kiosk has none, so this mirror on the settings lens is what wallet-less
 * surfaces read; Flow Management writes it whenever it syncs on-chain.
 */
export function readAllocationConfig(settings: unknown): AllocationConfig {
  const doc = (settings ?? {}) as Record<string, unknown>;
  const stored = doc[ALLOCATION_KEY];
  if (!stored) return { ...DEFAULT_ALLOCATION_CONFIG };
  return normalizeAllocationConfig(stored);
}

/**
 * Zone assignments for federated partners.
 *
 * Reads the canonical `allocation.zones` map, falling back to the legacy
 * top-level `federationZones` that Flow Management has been writing.
 */
export function readZoneAssignments(settings: unknown): Record<string, number> {
  const doc = (settings ?? {}) as Record<string, unknown>;
  const allocation = (doc[ALLOCATION_KEY] ?? {}) as Record<string, unknown>;
  const raw = (allocation.zones ?? doc[LEGACY_ZONES_KEY] ?? {}) as Record<string, unknown>;

  const zones: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw)) {
    const zone = Number(value);
    if (Number.isFinite(zone) && zone >= 1) zones[id] = Math.floor(zone);
  }
  return zones;
}

/**
 * Pair a federation snapshot with its zone assignments.
 *
 * Partners with no assignment are returned at zone 0 — unassigned, and so
 * outside every ring. `allocate` ignores them, which is correct: value is only
 * committed to a partner once someone has placed it.
 */
export function toAllocationPartners(
  federated: string[],
  partnerNames: Record<string, string>,
  zones: Record<string, number>,
): AllocationPartner[] {
  return (federated ?? []).map((id) => ({
    id,
    name: partnerNames?.[id] || id,
    zone: zones[id] ?? 0,
  }));
}

/** Persist the allocation split (and optionally zone assignments) off-chain. */
export async function saveAllocationConfig(
  holosphere: any,
  holonId: string,
  config: Partial<AllocationConfig>,
  zones?: Record<string, number>,
): Promise<AllocationConfig> {
  let existing: any = null;
  try {
    existing = await holosphere.get(String(holonId), 'settings', String(holonId));
  } catch {
    // See saveCollectiveSlug.
  }

  const current = readAllocationConfig(existing);
  const clean = normalizeAllocationConfig({ ...current, ...config });
  const existingZones = readZoneAssignments(existing);

  await holosphere.put(String(holonId), 'settings', {
    ...(existing ?? {}),
    id: String(holonId),
    [ALLOCATION_KEY]: {
      ...clean,
      zones: zones ?? existingZones,
    },
  });

  return clean;
}
