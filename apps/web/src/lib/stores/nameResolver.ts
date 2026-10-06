/**
 * Names on the web, from one place.
 *
 *   WRITE  →  src/lib/hns/index.ts   (HNS registration, untouched)
 *   READ   →  this file               (core's resolver + a reactive store)
 *
 * Every id a component shows — a Telegram id, a hex pubkey or npub, a holon
 * id — goes through `@holons/core/identity`'s `createNameResolver` over the
 * app's holosphere: the holon's `users`, the person's own record, the
 * kind-31926 key directory, kind-0 profiles on the relays, `settings.name`,
 * HNS. Templates read `$nameMap[id]`; `resolvedName()` answers at once with
 * the best known name or the one short form (`npub1…`, `#id`), never a bare
 * key and never "Unknown" for an id that exists.
 */

import { writable, get } from "svelte/store";
import type { HoloSphere } from "holosphere";
import {
  createNameResolver,
  normalizeId,
  shortId,
  userName,
  type NameResolver,
  type ProfileMeta,
} from "@holons/core/identity";
import { holosphereStore } from "./holosphere";
import { lookupName as hnsLookup, clearHNSCache } from "../hns";
import { ID } from "../../dashboard/store";

const RESERVED_NAMES = new Set([
  "no",
  "yes",
  "true",
  "false",
  "null",
  "undefined",
  "none",
  "n/a",
  "na",
  "nil",
  "empty",
  "blank",
  "unknown",
  "anonymous",
  "default",
]);

// ─── pure helpers ───────────────────────────────────────────────────

/** Validate that a holon name is acceptable. */
export function isValidHolonName(name: unknown): name is string {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;
  if (RESERVED_NAMES.has(trimmed.toLowerCase())) return false;
  return true;
}

/** Extract holon ID from a hologram soul path like "Holons/<id>/quests/380". */
export function extractHolonIdFromSoul(
  hologramSoul: string | undefined,
): string | null {
  if (!hologramSoul) return null;
  const match = hologramSoul.match(/Holons\/([^\/]+)/);
  return match ? match[1] : null;
}

/** Extract lens name and item ID from a hologram soul path. */
export function extractLensAndItemFromSoul(hologramSoul: string | undefined): {
  lens: string | null;
  itemId: string | null;
} {
  if (!hologramSoul) return { lens: null, itemId: null };
  const match = hologramSoul.match(/Holons\/[^\/]+\/([^\/]+)\/(.+)/);
  return match
    ? { lens: match[1], itemId: match[2] }
    : { lens: null, itemId: null };
}

/** Map holosphere lens names to SvelteKit route names. */
const lensToRoute: Record<string, string> = { quests: "tasks" };

export function lensToRouteName(lens: string): string {
  return lensToRoute[lens] || lens;
}

/** Build a deep link to a specific hologram's source task/lens. */
export function buildHologramLink(hologram: {
  soul?: string;
  sourceHolon?: string;
}): string {
  const holonId = hologram.sourceHolon || extractHolonIdFromSoul(hologram.soul);
  if (!holonId) return "/";
  const { lens, itemId } = extractLensAndItemFromSoul(hologram.soul);
  const route = lens ? lensToRouteName(lens) : "dashboard";
  const base = `/${holonId}/${route}`;
  return itemId ? `${base}?task=${itemId}` : base;
}

// ─── the resolver, bound to the app's holosphere ────────────────────

const _nameMap = writable<Record<string, string>>({});
let resolver: NameResolver | null = null;
let boundTo: HoloSphere | null = null;
const queued = new Set<string>();

function bind(hs: HoloSphere | null): NameResolver | null {
  if (!hs) return resolver;
  if (resolver && boundTo === hs) return resolver;
  const r = createNameResolver(hs as never, {
    holon: get(ID),
    hns: (id) => hnsLookup(hs, id),
  });
  r.subscribe((m) => _nameMap.set(Object.fromEntries(m)));
  resolver = r;
  boundTo = hs;
  if (queued.size) {
    const ids = [...queued];
    queued.clear();
    void r.resolve(ids);
  }
  return r;
}

holosphereStore.subscribe((hs) => void bind(hs));
ID.subscribe((id) => resolver?.setHolon(id));

function current(): NameResolver | null {
  return resolver ?? bind(get(holosphereStore));
}

// ─── reactive API (the single UI interface) ─────────────────────────

/**
 * Trigger async name resolution for any id. The result lands in `nameMap`.
 * Safe to call many times.
 */
export function resolveName(id: string | number | null | undefined): void {
  const n = normalizeId(id);
  if (!n) return;
  const r = current();
  if (r) r.nameOf(n);
  else queued.add(n);
}

/** Batch resolve multiple IDs. */
export function resolveNames(ids: Array<string | number>): void {
  for (const id of ids) resolveName(id);
}

/** Resolve hologram source: extract holon ID from soul path, then resolve. */
export function resolveHologramSource(hologramSoul: string): void {
  const holonId = extractHolonIdFromSoul(hologramSoul);
  if (holonId) resolveName(holonId);
}

/**
 * Awaitable: the name, else the short form. Use in imperative code (QR page,
 * federation, bookings).
 */
export async function awaitName(
  id: string | number | null | undefined,
): Promise<string> {
  const n = normalizeId(id);
  if (!n) return "";
  const r = current();
  if (!r) return shortId(n);
  try {
    return (await r.resolve([n])).get(n) ?? shortId(n);
  } catch {
    return shortId(n);
  }
}

/** The kind-0 profile learned for a key (picture, about…), if any. */
export function profileOf(
  id: string | number | null | undefined,
): ProfileMeta | undefined {
  return resolver?.profileOf(id);
}

/** Force refresh: forget the id and ask again. */
export function forceRefresh(id: string | number | null | undefined): void {
  const n = normalizeId(id);
  if (!n) return;
  clearHNSCache(n);
  resolver?.invalidate(n);
  _nameMap.update((map) => {
    const { [n]: _, ...rest } = map;
    return rest;
  });
  resolveName(n);
}

/** Forget and re-resolve, awaiting the answer (BrowserPanel's partner refresh). */
export async function forceRefreshHolonName(
  _hs: HoloSphere,
  id: string,
): Promise<string> {
  forceRefresh(id);
  return awaitName(id);
}

/**
 * Directly set a resolved name (no fetch needed). Use after writing
 * settings/HNS to avoid relay round-trip races.
 */
export function setName(
  id: string | number | null | undefined,
  name: string,
): void {
  const n = normalizeId(id);
  if (!n || !name) return;
  const r = current();
  if (r) r.prime([[n, name]]);
  else _nameMap.update((map) => ({ ...map, [n]: name }));
}

// ─── canonical display-name functions ───────────────────────────────

/** User object shape for name resolution. */
export interface NameUser {
  id?: string | number;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
}

/**
 * Canonical name for an id, right now. Works for people and holons alike.
 * Auto-triggers `resolveName()` as a side effect.
 *
 *   nameMap[id] → the user record's own name → `fallback` → the short form
 */
export function resolvedName(
  id: string | number | null | undefined,
  nameMap: Record<string, string>,
  user?: NameUser | null,
  fallback?: string,
): string {
  const n = normalizeId(id);
  if (n) resolveName(n);
  if (n && nameMap[n]) return nameMap[n];
  if (user) {
    const own = userName(user, { idFallback: false, unknown: "" });
    if (own) return own;
  }
  if (fallback) return fallback;
  return n ? shortId(n) : "Unknown";
}

/**
 * Canonical initials resolver. Derives initials from the resolved name.
 * Use for avatar fallbacks.
 */
export function resolvedInitials(
  id: string | number | undefined,
  nameMap: Record<string, string>,
  user?: NameUser | null,
): string {
  const name = resolvedName(id, nameMap, user);
  if (name === "Unknown" || name === shortId(id)) return "?";
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// ─── public store (read-only) ───────────────────────────────────────

export const nameMap = { subscribe: _nameMap.subscribe };
