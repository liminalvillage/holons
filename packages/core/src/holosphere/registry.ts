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
 * No surface calls it: `attachRegistry` (below, wired by `createHoloSphere`)
 * writes the entry whenever a holon's settings are written.
 */

import type { HoloSphere } from 'holosphere';
import { isPubkeyHolon } from 'holosphere/authority.js';
import { isValidCell } from 'h3-js';
import { isPlaceholderName } from '../identity/ids.js';
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

// ── Keeping the registry true on every write ───────────────────────────────

/**
 * Whether a holon is someone's own (`personal`: a pubkey, or a Telegram user
 * id — positive digits) or a shared one (`community`: a group id, a keyed
 * `holon_…`/`hub_…` id). One rule, so every surface labels holons alike.
 */
export function holonTypeOf(id: string | number): 'personal' | 'community' {
  const h = String(id ?? '').trim();
  return isPubkeyHolon(h) || /^\d+$/.test(h) ? 'personal' : 'community';
}

/** A holon id that can stand in the registry: not empty, not an address, not a map cell, not a system table. */
export function isRegistrableHolon(id: unknown): id is string {
  if (typeof id !== 'string' && typeof id !== 'number') return false;
  const h = String(id).trim();
  if (!h || h.includes('/') || h.startsWith('_')) return false;
  try {
    if (isValidCell(h)) return false;
  } catch {
    /* not a cell */
  }
  return true;
}

/**
 * The registry record a holon's settings describe. An entry already in the
 * registry keeps its creation time and, when the settings carry no real name
 * (none, or a stand-in like "unknown"), its name — such a write never blanks
 * a holon someone can find.
 */
export function registryEntryFromSettings(
  holon: string,
  settings: Record<string, unknown> | null | undefined,
  existing?: Partial<HolonRegistryEntry> | null,
): HolonRegistryEntry | null {
  if (!isRegistrableHolon(holon)) return null;
  const s = settings ?? {};
  // A stand-in ("unknown", "Holon 123", the id itself) never replaces a real name.
  const real = (n: unknown) => (isPlaceholderName(n, holon) ? '' : str(n).trim());
  const name = real(s.name) || real(existing?.name) || str(existing?.name).trim();
  const created =
    (typeof existing?.created === 'string' && existing.created) ||
    (typeof s.created === 'string' || typeof s.created === 'number' ? (s.created as string | number) : null) ||
    (typeof s.createdAt === 'number' || typeof s.createdAt === 'string' ? (s.createdAt as string | number) : null);
  return buildRegistryEntry({
    id: holon,
    name,
    purpose: str(s.purpose) || str(existing?.purpose),
    created,
    type: holonTypeOf(holon),
  });
}

/** The slice of a HoloSphere instance the registry hook touches. */
export interface RegistryHost {
  put(holon: string | null, lens: string, data: any, passwordOrOptions?: any, options?: any): Promise<any>;
  writeGlobal(table: string, data: any, options?: any): Promise<any>;
  isHologram?(data: unknown): boolean;
  store?: { get(holon: string | null, lens: string, id: string): { item?: unknown } | undefined };
}

export interface AttachRegistryOptions {
  /** Report a registry failure; defaults to `console.warn`. */
  log?: (message: string, error?: unknown) => void;
}

const REGISTRY_ATTACHED = Symbol.for('holons.registry.attached');

/** True when `attachRegistry` already wrapped this instance. */
export function hasRegistry(host: unknown): boolean {
  return !!host && typeof host === 'object' && (host as any)[REGISTRY_ATTACHED] === true;
}

const sameEntry = (a: Partial<HolonRegistryEntry> | null | undefined, b: HolonRegistryEntry): boolean =>
  !!a && str(a.name) === b.name && str(a.purpose) === b.purpose && str(a.type) === b.type && !!a.created;

/**
 * Every holon whose settings are written is findable. `attachRegistry` wraps
 * `put`: after a write to a holon's `settings` lens it refreshes that holon's
 * `holons_registry` entry (name, purpose, type), writing only when the entry
 * would change. Founding a holon on the kiosk, a bot dropped into a group,
 * a rename on the web, an MCP settings save — all are settings writes, so
 * no surface registers anything itself.
 *
 * Skipped: global writes, private (password) writes, tombstones, hologram
 * pointers, federated copies, and ids that are not holons (addresses, map
 * cells, system tables). The settings write is never blocked: a registry
 * failure is logged and swallowed.
 */
export function attachRegistry<T extends RegistryHost>(host: T, opts: AttachRegistryOptions = {}): T {
  if (hasRegistry(host)) return host;
  const log = opts.log ?? ((message: string, error?: unknown) => console.warn(message, error ?? ''));
  const rawPut = host.put;
  // What this instance last wrote per holon — a cold store holds no registry
  // rows, and a settings save must not rewrite the same entry every time.
  const written = new Map<string, string>();

  host.put = async function registryPut(this: T, holon: any, lens: any, data: any, passwordOrOptions: any = null, options: any = {}) {
    const result = await rawPut.call(this, holon, lens, data, passwordOrOptions, options);
    const password = typeof passwordOrOptions === 'string' ? passwordOrOptions : passwordOrOptions?.password;
    const opts2 = (passwordOrOptions && typeof passwordOrOptions === 'object' ? passwordOrOptions : options) ?? {};
    const eligible =
      lens === 'settings' &&
      holon != null &&
      isRegistrableHolon(holon) &&
      !password &&
      !opts2.preserveFederationMeta &&
      data &&
      typeof data === 'object' &&
      data._deleted !== true &&
      !(data as any)._federation &&
      !(host.isHologram?.(data) ?? false);
    if (!eligible) return result;
    const h = String(holon).trim();
    try {
      let existing: Partial<HolonRegistryEntry> | null = null;
      try {
        const item = host.store?.get(null, HOLONS_REGISTRY_TABLE, h)?.item;
        if (item && typeof item === 'object' && (item as any)._deleted !== true) existing = item as Partial<HolonRegistryEntry>;
      } catch {
        existing = null;
      }
      const entry = registryEntryFromSettings(h, data, existing);
      if (!entry) return result;
      const sig = JSON.stringify([entry.name, entry.purpose, entry.type]);
      if (sameEntry(existing, entry) || written.get(h) === sig) return result;
      await host.writeGlobal(HOLONS_REGISTRY_TABLE, entry);
      written.set(h, sig);
    } catch (err) {
      log(`[registry] could not register holon ${h}`, err);
    }
    return result;
  };
  Object.defineProperty(host, REGISTRY_ATTACHED, { value: true, enumerable: false });
  return host;
}
