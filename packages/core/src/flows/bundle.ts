// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The on-chain bundle record, and the repair of how it used to be stored.
 *
 * ## The bug this exists to fix
 *
 * Flow Management persisted its deployed-bundle address and its zone
 * assignments with a bare `holosphere.put(holonId, 'settings', { bundle })` —
 * no merge over the existing document, and no `id` stamp. Both halves matter:
 *
 *  - **No `id`.** `ContentOps.put` keys a record by `data.id` and *generates a
 *    random one when it is missing*. So every call minted a brand-new record on
 *    the settings lens. Deploying twice left two orphans; syncing zones five
 *    times left five, each a complete snapshot of a different moment.
 *  - **No merge.** Even had the key been right, a raw put would have dropped
 *    `name`, `hex`, `valueEquation` and `currencies`.
 *
 * That is why the loader had to *scan* — `getAll(holonId, 'settings').find(s =>
 * s.bundle)` — taking whichever orphan Gun happened to list first. With several
 * orphans that is a coin toss between a current address and a stale one, and
 * nothing on the canonical settings document ever saw the bundle at all.
 *
 * ## The fix
 *
 * `saveBundleRecord` writes through the same read-merge-write path as
 * `saveEquation`, so the bundle lands on the canonical settings document.
 * `readBundleRecord` reads it from there.
 *
 * Existing deployments still have their bundle in an orphan, so the read path
 * cannot simply switch over: `migrateLegacyBundleRecord` folds the orphans
 * forward and deletes them, and is safe to call on every load (it no-ops once
 * there is nothing left to move).
 */

import type { AllocationConfig } from './allocation.js';
import { ALLOCATION_KEY, readAllocationConfig, readZoneAssignments } from './settings.js';

/** Settings field holding the deployed contract bundle. */
export const BUNDLE_KEY = 'bundle';

/** Legacy top-level field holding partner zone assignments. */
export const LEGACY_ZONES_KEY = 'federationZones';

/** The deployed Holons contract bundle for a holon. */
export interface HolonBundleRecord {
  address: string;
  creatorUserId?: string;
  /** Contract steepness, WAD-scaled, kept as a string (it exceeds Number). */
  steepness?: string;
  nzones?: number;
  deployedAt?: number;
  txHash?: string;
}

const isAddress = (value: unknown): value is string =>
  typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);

/** Coerce a stored record, returning null when there is no usable address. */
function toBundle(raw: unknown): HolonBundleRecord | null {
  const doc = (raw ?? {}) as Record<string, unknown>;
  if (!isAddress(doc.address)) return null;
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    address: doc.address,
    creatorUserId: doc.creatorUserId != null ? String(doc.creatorUserId) : undefined,
    steepness: doc.steepness != null ? String(doc.steepness) : undefined,
    nzones: num(doc.nzones),
    deployedAt: num(doc.deployedAt),
    txHash: doc.txHash != null ? String(doc.txHash) : undefined,
  };
}

/** The holon's bundle as stored on the canonical settings document. */
export function readBundleRecord(settings: unknown): HolonBundleRecord | null {
  const doc = (settings ?? {}) as Record<string, unknown>;
  return toBundle(doc[BUNDLE_KEY]);
}

/**
 * Persist the deployed bundle, merged onto the canonical settings document.
 *
 * The `id` stamp is what keeps this from forking a new record, and the spread
 * is what keeps the rest of the document alive.
 */
export async function saveBundleRecord(
  holosphere: any,
  holonId: string,
  bundle: HolonBundleRecord,
): Promise<void> {
  let existing: any = null;
  try {
    existing = await holosphere.get(String(holonId), 'settings', String(holonId));
  } catch {
    // A failed read must not lose the deploy: write the bundle alone rather
    // than dropping it.
  }

  await holosphere.put(String(holonId), 'settings', {
    ...(existing ?? {}),
    id: String(holonId),
    [BUNDLE_KEY]: bundle,
  });
}

export interface BundleMigration {
  /** Orphan settings records found (keyed by anything but the holon id). */
  found: number;
  /** Whether a bundle was folded onto the canonical document. */
  movedBundle: boolean;
  /** Whether zone assignments were folded onto the canonical document. */
  movedZones: boolean;
  /** Orphan record keys deleted. */
  deleted: string[];
  /**
   * True when several orphans carried zone maps and none could be ordered, so
   * the choice below was a heuristic rather than a fact. Callers may want to
   * tell the user to re-check the zones.
   */
  ambiguous: boolean;
}

const NONE: BundleMigration = {
  found: 0,
  movedBundle: false,
  movedZones: false,
  deleted: [],
  ambiguous: false,
};

/**
 * Fold orphaned Flow Management records onto the canonical settings document.
 *
 * Best-effort and idempotent — safe to call on every load. Once the orphans are
 * gone it costs one `getAll` and returns immediately.
 *
 * Rules, in order of how much they matter:
 *
 *  - **The canonical document always wins.** A value already stored there is
 *    never overwritten by an orphan; orphans are strictly older by definition.
 *  - **Bundles are ordered by `deployedAt`** — the newest deploy is the live
 *    contract.
 *  - **Zone maps cannot be ordered.** Each sync wrote a *complete* snapshot, so
 *    merging them would resurrect assignments a later sync had moved; one map
 *    must be picked whole. With no timestamp to go on, the largest is taken and
 *    `ambiguous` is set, rather than pretending the choice was informed.
 */
export async function migrateLegacyBundleRecord(
  holosphere: any,
  holonId: string,
): Promise<BundleMigration> {
  const id = String(holonId ?? '').trim();
  if (!id) return NONE;

  let records: any[] = [];
  try {
    records = (await holosphere.getAll(id, 'settings')) ?? [];
  } catch {
    return NONE;
  }
  if (!Array.isArray(records)) return NONE;

  const canonical = records.find((r) => r && String(r.id ?? '') === id) ?? null;
  const orphans = records.filter(
    (r) =>
      r &&
      String(r.id ?? '') !== id &&
      (r[BUNDLE_KEY] != null || r[LEGACY_ZONES_KEY] != null),
  );
  if (orphans.length === 0) return NONE;

  const result: BundleMigration = {
    found: orphans.length,
    movedBundle: false,
    movedZones: false,
    deleted: [],
    ambiguous: false,
  };

  const patch: Record<string, unknown> = {};

  // Bundle: newest deploy wins, and only when the canonical doc has none.
  //
  // The RAW record is carried forward, not the normalized one. Two components
  // write this key with different shapes (ContractDeploy stores `type`, `name`
  // and `chainId`; Flow Management stores `steepness`, `nzones` and
  // `creatorUserId`), and normalizing on the way through would silently drop
  // whichever fields this module does not model. Validation and ordering still
  // go through `toBundle`.
  if (!readBundleRecord(canonical)) {
    const candidates = orphans
      .map((r) => ({ raw: r[BUNDLE_KEY], parsed: toBundle(r[BUNDLE_KEY]) }))
      .filter((c): c is { raw: unknown; parsed: HolonBundleRecord } => c.parsed != null)
      .sort((a, b) => (b.parsed.deployedAt ?? 0) - (a.parsed.deployedAt ?? 0));
    if (candidates.length > 0) {
      patch[BUNDLE_KEY] = candidates[0].raw;
      result.movedBundle = true;
    }
  }

  // Zones: one complete snapshot, chosen whole. See the note above on why these
  // are not merged.
  const canonicalZones = readZoneAssignments(canonical);
  if (Object.keys(canonicalZones).length === 0) {
    const maps = orphans
      .map((r) => readZoneAssignments({ [LEGACY_ZONES_KEY]: r[LEGACY_ZONES_KEY] }))
      .filter((m) => Object.keys(m).length > 0)
      .sort((a, b) => Object.keys(b).length - Object.keys(a).length);
    if (maps.length > 0) {
      const config: AllocationConfig = readAllocationConfig(canonical);
      patch[ALLOCATION_KEY] = { ...config, zones: maps[0] };
      result.movedZones = true;
      result.ambiguous = maps.length > 1;
    }
  }

  if (result.movedBundle || result.movedZones) {
    await holosphere.put(id, 'settings', {
      ...(canonical ?? {}),
      id,
      ...patch,
    });
  }

  // Drop the orphans so the lens stops accumulating them and no later reader is
  // tempted to scan again. A failed delete is not fatal — the canonical record
  // is already correct, and the orphan is merely litter.
  for (const orphan of orphans) {
    const key = String(orphan.id ?? '');
    if (!key || key === id) continue;
    try {
      await holosphere.delete(id, 'settings', key);
      result.deleted.push(key);
    } catch {
      // Leave it; the next load will try again.
    }
  }

  return result;
}
