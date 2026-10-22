// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
/**
 * Global holon registry — the maintained index of every holon.
 *
 * The relay has no "enumerate all holons" operation: a fresh peer can
 * only see the nodes it happens to have synced. So the global view relies on
 * a single enumerable table (`holons_registry`) that every holon writes
 * itself into at creation time. `registerHolon` is that write.
 *
 * Two properties matter:
 *   1. **Idempotent** — keyed by holon id (`writeGlobal` derives the key from
 *      `entry.id`), so re-registering an existing holon just refreshes its
 *      record rather than duplicating it.
 *   2. **Best-effort** — it never throws. Registration is a side-channel for
 *      discoverability; a registry hiccup must not block holon creation.
 *
 * Both `apps/web` and `packages/telegram-ui` call this so every surface seeds
 * the registry with the same record shape.
 */

import type { HoloSphere } from 'holosphere';
import { normalizePubkey } from '../users/keys.js';

/** Global table holding the holon index. */
export const HOLONS_REGISTRY_TABLE = 'holons_registry';

/** The canonical record stored per holon in {@link HOLONS_REGISTRY_TABLE}. */
export interface HolonRegistryEntry {
  /** Holon id — also the table key. */
  id: string;
  name: string;
  purpose: string;
  /** Canonical creation timestamp (ISO string). */
  created: string;
  /** Loose classifier, e.g. `'personal'` | `'community'`. */
  type: string;
}

/** Loosely-typed input accepted by {@link registerHolon}. */
export interface RegisterHolonInput {
  id: string | number;
  name?: string | null;
  purpose?: string | null;
  /** ISO string or ms-epoch number; coerced to canonical ISO. */
  created?: string | number | null;
  type?: string | null;
}

/** Coerce a legacy `createdAt` (ms epoch) or ISO `created` to canonical ISO. */
function toCreatedIso(created?: string | number | null): string {
  if (typeof created === 'string' && created) return created;
  if (typeof created === 'number' && Number.isFinite(created)) {
    return new Date(created).toISOString();
  }
  return new Date().toISOString();
}

/**
 * Normalise raw input into a {@link HolonRegistryEntry}, or `null` when the
 * id is missing/blank (nothing useful can be written without a key).
 */
export function buildRegistryEntry(input: RegisterHolonInput): HolonRegistryEntry | null {
  const id = input.id == null ? '' : String(input.id).trim();
  if (!id) return null;

  const name = (input.name ?? '').toString().trim() || `Holon ${id}`;

  return {
    id,
    name,
    purpose: (input.purpose ?? '').toString(),
    created: toCreatedIso(input.created),
    type: (input.type ?? 'community').toString(),
  };
}

/**
 * Write a holon's record into the global registry. Returns `true` on success,
 * `false` if the input had no usable id or the write failed (never throws).
 */
export async function registerHolon(
  holosphere: Pick<HoloSphere, 'writeGlobal'>,
  input: RegisterHolonInput,
): Promise<boolean> {
  const entry = buildRegistryEntry(input);
  if (!entry) return false;

  try {
    await holosphere.writeGlobal(HOLONS_REGISTRY_TABLE, entry);
    return true;
  } catch (err) {
    console.warn(
      '[registerHolon] failed to write registry entry for',
      entry.id,
      '—',
      (err as Error)?.message ?? err,
    );
    return false;
  }
}

/** A registry hit, as a picker shows it. */
export interface HolonSearchHit {
  id: string;
  name: string;
  type: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/**
 * Pure search over registry entries: an exact id (or an npub, which is a
 * personal holon's id) wins outright; otherwise a case-insensitive substring
 * match on the name, then on the id. Deduplicated by id, name order.
 */
export function searchRegistry(entries: readonly unknown[], query: string, limit = 20): HolonSearchHit[] {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const exactId = normalizePubkey(q) ?? q;
  const seen = new Set<string>();
  const hits: HolonSearchHit[] = [];
  const push = (e: HolonRegistryEntry) => {
    if (seen.has(e.id)) return;
    seen.add(e.id);
    hits.push({ id: e.id, name: e.name, type: e.type });
  };
  const rows = entries
    .map((e) => buildRegistryEntry((e ?? {}) as RegisterHolonInput))
    .filter((e): e is HolonRegistryEntry => !!e);
  for (const e of rows) if (e.id === exactId) push(e);
  const needle = q.toLowerCase();
  const byName = rows.filter((e) => e.name.toLowerCase().includes(needle)).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of byName) push(e);
  for (const e of rows) if (str(e.id).toLowerCase().includes(needle)) push(e);
  // An id typed in full that the registry does not know yet is still a holon
  // someone can share with: a personal holon (npub or hex) or a group id.
  const looksLikeId = /^(-?\d{4,}|[0-9a-f]{64}|(holon|hub)_[a-z0-9]{12,32})$/i.test(exactId);
  if (!seen.has(exactId) && looksLikeId) {
    hits.unshift({ id: exactId, name: exactId, type: /^[0-9a-f]{64}$/i.test(exactId) ? 'personal' : 'community' });
  }
  return hits.slice(0, limit);
}

/** Search the global registry by name or id (never a key field: an npub is a personal holon's id). */
export async function searchHolons(
  holosphere: Pick<HoloSphere, 'getAllGlobal'>,
  query: string,
  limit = 20,
): Promise<HolonSearchHit[]> {
  let entries: unknown[] = [];
  try {
    const raw = await holosphere.getAllGlobal(HOLONS_REGISTRY_TABLE);
    entries = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  } catch {
    entries = [];
  }
  return searchRegistry(entries, query, limit);
}
