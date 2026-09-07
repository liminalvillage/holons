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

/**
 * Field under `allocation` holding PEOPLE placed on reciprocity zones.
 *
 * Kept apart from `zones`, which is the federation partners' map that Flow
 * Management mirrors on-chain: a partner that is unlinked keeps a stale zone
 * entry that `toAllocationPartners` drops by not finding it in the
 * federation record, and folding people into the same map would resurrect
 * every such ghost. People have no federation record to check against, so
 * their map is authoritative on its own.
 */
const PEOPLE_KEY = 'people';

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
  return cleanZoneMap(allocation.zones ?? doc[LEGACY_ZONES_KEY]);
}

/**
 * Zone placements for people — members or anyone else the holon shares with
 * in relationship rather than for tasks — keyed by user id.
 */
export function readZonePeople(settings: unknown): Record<string, number> {
  const doc = (settings ?? {}) as Record<string, unknown>;
  const allocation = (doc[ALLOCATION_KEY] ?? {}) as Record<string, unknown>;
  return cleanZoneMap(allocation[PEOPLE_KEY]);
}

/** Only ids placed on a real ring survive; anything else is "not placed". */
function cleanZoneMap(raw: unknown): Record<string, number> {
  const zones: Record<string, number> = {};
  for (const [id, value] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    const zone = Number(value);
    if (Number.isFinite(zone) && zone >= 1 && id) zones[id] = Math.floor(zone);
  }
  return zones;
}

/**
 * Pair a federation snapshot with its zone assignments, then the people
 * placed on rings.
 *
 * Partners with no assignment are returned at zone 0 — unassigned, and so
 * outside every ring. `allocate` ignores them, which is correct: value is only
 * committed to a partner once someone has placed it. People only appear when
 * placed (an unplaced person is simply not in the map); a person whose id is
 * also a federation partner keeps the partner's seat.
 */
export function toAllocationPartners(
  federated: string[],
  partnerNames: Record<string, string>,
  zones: Record<string, number>,
  people: Record<string, number> = {},
  peopleNames: Record<string, string> = {},
): AllocationPartner[] {
  // The federation record can list a partner twice (double link, replayed
  // write); UIs key on the id, so dedupe here rather than in every renderer.
  const ids = [...new Set((federated ?? []).map((id) => String(id ?? '')).filter(Boolean))];
  const holons: AllocationPartner[] = ids.map((id) => ({
    id,
    name: partnerNames?.[id] || id,
    zone: zones[id] ?? 0,
    kind: 'holon',
  }));
  const seated = new Set(ids);
  const persons: AllocationPartner[] = Object.entries(people ?? {})
    .filter(([id, zone]) => id && zone >= 1 && !seated.has(id))
    .map(([id, zone]) => ({
      id,
      name: peopleNames?.[id] || partnerNames?.[id] || id,
      zone,
      kind: 'person',
    }));
  return [...holons, ...persons];
}

/**
 * Persist the allocation split (and optionally zone assignments) off-chain.
 *
 * `zones` and `people` each replace their map only when given; a caller that
 * syncs partner zones (Flow Management) leaves the people placements alone,
 * and vice versa.
 */
export async function saveAllocationConfig(
  holosphere: any,
  holonId: string,
  config: Partial<AllocationConfig>,
  zones?: Record<string, number>,
  people?: Record<string, number>,
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
  const existingPeople = readZonePeople(existing);

  await holosphere.put(String(holonId), 'settings', {
    ...(existing ?? {}),
    id: String(holonId),
    [ALLOCATION_KEY]: {
      ...clean,
      zones: zones ?? existingZones,
      [PEOPLE_KEY]: cleanZoneMap(people ?? existingPeople),
    },
  });

  return clean;
}
