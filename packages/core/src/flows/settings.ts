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
  normalizeInteriorShares,
  type AllocationConfig,
  type AllocationPartner,
  type InteriorShares,
} from './allocation.js';
import { normalizeAliases, normalizeBuckets, splitHash, type Aliases, type AllocationBucket, type ClaimWindow } from './buckets.js';
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

/**
 * Field under `allocation` holding the CUSTOM contributors' split, by user id.
 *
 * Only read when `allocation.interiorMode` is `custom`; kept through a switch
 * back to `equation` so a caretaker can flip between the two without losing
 * the hand-set numbers.
 */
const SHARES_KEY = 'shares';

/**
 * Field under `allocation` holding the BUCKETS — the interior divided by
 * several rules at once (`buckets.ts`). Absent or empty: the interior is
 * divided the single way `interiorMode` says.
 */
const BUCKETS_KEY = 'buckets';

/**
 * Field under `allocation` mapping a placeholder the importer seated onto
 * the party who claimed it. Read by every split that names the placeholder.
 */
const ALIASES_KEY = 'aliases';

/**
 * Field under `allocation` pinning the split at genesis: the hash of the
 * rule (`splitHash`) and when it was locked. A locked split refuses a change
 * to its buckets, weights or contributors' percent; aliases and codes — the
 * rule at work — still move.
 */
const GENESIS_KEY = 'genesis';

/**
 * Field under `allocation` holding claim codes: sha256(code) → what the code
 * claims (a placeholder party here, a project holon on its fund, or — as a
 * `seatClaim` — this holon's own seat one level up). A code is
 * consumed by removing it; the plain code never touches the store.
 */
const CODES_KEY = 'codes';

/**
 * Field under `allocation` holding the claim window: until when the seats of
 * this split may be claimed, and which seats need no claim. Past it, a seat
 * nobody claimed is retired like an exit (`lapsedSeats`). Set with the lock,
 * and held by it: a locked split refuses a change to its window.
 */
const CLAIM_WINDOW_KEY = 'claimWindow';
const APPLICATIONS_KEY = 'applications';

export interface AllocationGenesis {
  hash: string;
  /** When the split was locked (ms). */
  at: number;
}

/** sha256(code) → the id the code claims. */
export type ClaimCodes = Record<string, string>;

const SEAT_CLAIM = 'seat:';

/**
 * What a code claims when it is kept on a holon's OWN document: that holon's
 * seat in `parent`. A project seated straight in a Pot carries its claim code
 * itself this way — two thousand codes on the Pot's one document would not
 * fit an event — and whoever redeems it is aliased to the project on `parent`.
 */
export function seatClaim(parent: string): string {
  const id = String(parent ?? '').trim();
  if (!id) throw new Error('A seat claim names the holon the seat is in');
  return `${SEAT_CLAIM}${id}`;
}

/** The holon a seat claim's seat is in, or null when the target is an ordinary one. */
export function parseSeatClaim(target: unknown): string | null {
  const text = String(target ?? '').trim();
  if (!text.startsWith(SEAT_CLAIM)) return null;
  return text.slice(SEAT_CLAIM.length).trim() || null;
}

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
 * Whether the holon ever stored a split of its own.
 *
 * `readAllocationConfig` answers with the 50/50 defaults when nothing is
 * stored, which is right for an editor and wrong for a cascade: a holon that
 * never configured anything must not start re-dividing what it receives.
 */
export function hasAllocationConfig(settings: unknown): boolean {
  const doc = (settings ?? {}) as Record<string, unknown>;
  const stored = doc[ALLOCATION_KEY];
  return stored != null && typeof stored === 'object';
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

/**
 * The hand-set contributors' split, by user id — meaningful only when the
 * config's `interiorMode` is `custom`. Empty when never set.
 */
export function readInteriorShares(settings: unknown): InteriorShares {
  const doc = (settings ?? {}) as Record<string, unknown>;
  const allocation = (doc[ALLOCATION_KEY] ?? {}) as Record<string, unknown>;
  return normalizeInteriorShares(allocation[SHARES_KEY]);
}

/** The buckets the interior is divided by, or `[]` for a single-mode split. */
export function readAllocationBuckets(settings: unknown): AllocationBucket[] {
  const doc = (settings ?? {}) as Record<string, unknown>;
  const allocation = (doc[ALLOCATION_KEY] ?? {}) as Record<string, unknown>;
  return normalizeBuckets(allocation[BUCKETS_KEY]);
}

/** Placeholder → the party who claimed it. Empty when none. */
export function readAllocationAliases(settings: unknown): Aliases {
  const doc = (settings ?? {}) as Record<string, unknown>;
  const allocation = (doc[ALLOCATION_KEY] ?? {}) as Record<string, unknown>;
  return normalizeAliases(allocation[ALIASES_KEY]);
}

/** The genesis lock, or null when the split may still be edited. */
export function readAllocationGenesis(settings: unknown): AllocationGenesis | null {
  const doc = (settings ?? {}) as Record<string, unknown>;
  const allocation = (doc[ALLOCATION_KEY] ?? {}) as Record<string, unknown>;
  const g = (allocation[GENESIS_KEY] ?? null) as Record<string, unknown> | null;
  const hash = String(g?.hash ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  const at = Number(g?.at);
  return { hash, at: Number.isFinite(at) ? at : 0 };
}

/** The claim window on this holon's seats, or null when they may be claimed any time. */
export function readAllocationClaimWindow(settings: unknown): ClaimWindow | null {
  const doc = (settings ?? {}) as Record<string, unknown>;
  const allocation = (doc[ALLOCATION_KEY] ?? {}) as Record<string, unknown>;
  return cleanClaimWindow(allocation[CLAIM_WINDOW_KEY]);
}

function cleanClaimWindow(raw: unknown): ClaimWindow | null {
  const w = (raw ?? null) as Record<string, unknown> | null;
  const until = Number(w?.until);
  if (!Number.isFinite(until) || until <= 0) return null;
  const keep = Array.isArray(w?.keep) ? [...new Set(w.keep.map((id) => String(id ?? '').trim()).filter(Boolean))].sort() : [];
  return { until, keep };
}

/** The claim codes still open on this holon. */
export function readAllocationCodes(settings: unknown): ClaimCodes {
  const doc = (settings ?? {}) as Record<string, unknown>;
  const allocation = (doc[ALLOCATION_KEY] ?? {}) as Record<string, unknown>;
  return cleanCodes(allocation[CODES_KEY]);
}

/** The rule a lock pins, read off a settings document. */
export function allocationSplitHash(settings: unknown): string {
  return splitHash({
    interiorPercent: readAllocationConfig(settings).interiorPercent,
    buckets: readAllocationBuckets(settings),
    shares: readInteriorShares(settings),
  });
}

function cleanCodes(raw: unknown): ClaimCodes {
  const out: ClaimCodes = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [hash, target] of Object.entries(raw as Record<string, unknown>)) {
    const h = String(hash ?? '').trim().toLowerCase();
    const t = String(target ?? '').trim();
    if (/^[0-9a-f]{64}$/.test(h) && t) out[h] = t;
  }
  return out;
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
  // A person's id is their personal holon's id, and a joined personal holon
  // is also a federation partner: a ring set on the person must still count
  // when the partner map says nothing, or the placement silently vanishes.
  const holons: AllocationPartner[] = ids.map((id) => ({
    id,
    name: partnerNames?.[id] || id,
    zone: zones[id] ?? people?.[id] ?? 0,
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
 * Whether the holon takes applications (`flow_applications`). Open unless an
 * admin closed it: a fund that says nothing is a fund one may ask.
 */
export function readApplicationsOpen(settings: unknown): boolean {
  const raw = (settings as any)?.[ALLOCATION_KEY]?.[APPLICATIONS_KEY];
  return String(raw ?? '').trim().toLowerCase() !== 'closed';
}

export interface SaveAllocationExtra {
  /** Replaces the bucket list when given; `[]` returns to a single-mode split. */
  buckets?: AllocationBucket[];
  /** Replaces the alias map when given. */
  aliases?: Aliases;
  /** Replaces the claim codes when given. */
  codes?: ClaimCodes;
  /** Sets the claim window when given; `null` removes it. A locked split needs `force`. */
  claimWindow?: { until: number; keep?: string[] } | null;
  /** `true` locks the resulting split now; `null` lifts the lock (needs `force`). */
  genesis?: true | null;
  /** Open or close the holon to applications when given. Never part of the locked rule. */
  applications?: 'open' | 'closed';
  /** Change a locked split anyway. The cut will still report the drift. */
  force?: boolean;
  /** The clock, for the lock's timestamp. */
  now?: number;
}

/**
 * Persist the allocation split (and optionally zone assignments) off-chain.
 *
 * `zones`, `people`, `shares`, `buckets`, `aliases` and `codes` each replace
 * their map only when given; a caller that syncs partner zones (Flow
 * Management) leaves the people placements and the custom split alone, and
 * vice versa.
 *
 * A split locked at genesis refuses any change to its rule — the buckets,
 * their weights, the contributors' percent — unless `force` is set. Aliases
 * and codes are never the rule and always save. The claim window is held by
 * the same lock.
 */
export async function saveAllocationConfig(
  holosphere: any,
  holonId: string,
  config: Partial<AllocationConfig>,
  zones?: Record<string, number>,
  people?: Record<string, number>,
  shares?: InteriorShares,
  extra: SaveAllocationExtra = {},
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
  const existingShares = readInteriorShares(existing);
  const existingBuckets = readAllocationBuckets(existing);
  const existingAliases = readAllocationAliases(existing);
  const existingCodes = readAllocationCodes(existing);
  const existingWindow = readAllocationClaimWindow(existing);
  const locked = readAllocationGenesis(existing);
  const nextWindow = extra.claimWindow === undefined ? existingWindow : cleanClaimWindow(extra.claimWindow);

  const nextShares = normalizeInteriorShares(shares ?? existingShares);
  const nextBuckets = normalizeBuckets(extra.buckets ?? existingBuckets);
  const hash = splitHash({ interiorPercent: clean.interiorPercent, buckets: nextBuckets, shares: nextShares });

  if (locked && !extra.force) {
    if (hash !== locked.hash) throw new Error('The split is locked at genesis');
    if (extra.genesis === null) throw new Error('The split is locked at genesis');
    if (JSON.stringify(nextWindow) !== JSON.stringify(existingWindow)) throw new Error('The claim window is locked at genesis');
  }
  let genesis: AllocationGenesis | null = locked;
  if (extra.genesis === true) genesis = { hash, at: extra.now ?? Date.now() };
  else if (extra.genesis === null) genesis = null;
  else if (locked && extra.force && hash !== locked.hash) genesis = { hash, at: extra.now ?? Date.now() };

  await holosphere.put(String(holonId), 'settings', {
    ...(existing ?? {}),
    id: String(holonId),
    [ALLOCATION_KEY]: {
      ...clean,
      zones: zones ?? existingZones,
      [PEOPLE_KEY]: cleanZoneMap(people ?? existingPeople),
      [SHARES_KEY]: nextShares,
      ...(nextBuckets.length ? { [BUCKETS_KEY]: nextBuckets } : {}),
      ...(Object.keys(extra.aliases ?? existingAliases).length ? { [ALIASES_KEY]: normalizeAliases(extra.aliases ?? existingAliases) } : {}),
      ...(Object.keys(extra.codes ?? existingCodes).length ? { [CODES_KEY]: cleanCodes(extra.codes ?? existingCodes) } : {}),
      ...(genesis ? { [GENESIS_KEY]: genesis } : {}),
      ...(nextWindow ? { [CLAIM_WINDOW_KEY]: nextWindow } : {}),
      ...((extra.applications ?? (readApplicationsOpen(existing) ? 'open' : 'closed')) === 'closed' ? { [APPLICATIONS_KEY]: 'closed' } : {}),
    },
  });

  return clean;
}

/**
 * Patch the alias map alone: a claimed placeholder, by read-merge-write of
 * that one field. A `null` or empty value removes the alias.
 */
export async function saveAllocationAliases(
  holosphere: any,
  holonId: string,
  patch: Record<string, string | null | undefined>,
): Promise<Aliases> {
  let existing: any = null;
  try {
    existing = await holosphere.get(String(holonId), 'settings', String(holonId));
  } catch {
    // See saveCollectiveSlug.
  }
  const aliases = { ...readAllocationAliases(existing) };
  for (const [from, to] of Object.entries(patch ?? {})) {
    const f = String(from ?? '').trim();
    if (!f) continue;
    if (to == null || String(to).trim() === '') delete aliases[f];
    else aliases[f] = String(to).trim();
  }
  await saveAllocationConfig(holosphere, holonId, {}, undefined, undefined, undefined, { aliases });
  return normalizeAliases(aliases);
}

/**
 * Patch the claim codes alone: sha256(code) → what it claims; `null` consumes
 * one. The plain code never touches the store.
 */
export async function saveAllocationCodes(
  holosphere: any,
  holonId: string,
  patch: Record<string, string | null | undefined>,
): Promise<ClaimCodes> {
  let existing: any = null;
  try {
    existing = await holosphere.get(String(holonId), 'settings', String(holonId));
  } catch {
    // See saveCollectiveSlug.
  }
  const codes = { ...readAllocationCodes(existing) };
  for (const [hash, target] of Object.entries(patch ?? {})) {
    const h = String(hash ?? '').trim().toLowerCase();
    if (!h) continue;
    if (target == null || String(target).trim() === '') delete codes[h];
    else codes[h] = String(target).trim();
  }
  await saveAllocationConfig(holosphere, holonId, {}, undefined, undefined, undefined, { codes });
  return cleanCodes(codes);
}
