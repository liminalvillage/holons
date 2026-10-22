// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every name the kiosk shows for an id comes from here: one core resolver
// (`@holons/core/identity` createNameResolver) over the kiosk's holosphere,
// fed what the kiosk already knows (the signed-in person, federation partner
// names, the shift directory) and asked for the rest — the holon's `users`,
// the kind-31926 directory, kind-0 profiles on the relays, settings and HNS.
// A template reads `$nameOf(id)`: the short form at once, the name as soon as
// it is learned. Nothing on screen ever prints a bare hex key or Telegram id.

import { get, type Readable } from "svelte/store";
import {
  createNameResolver,
  normalizeId,
  shortId,
  userName,
  type NameResolver,
  type ProfileMeta,
} from "@holons/core/identity";
import { holonId, names, partnerNames, shiftNames } from "$lib/stores";

type SelfLike = {
  id: string | number;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
} | null;

/** Every name learned so far, id → name (the store lives in `$lib/stores`). */
export { names };

let resolver: NameResolver | null = null;
let starting: Promise<NameResolver> | null = null;
let selfRef: () => SelfLike = () => null;
const pending = new Set<string>();

/** `auth.ts` tells the resolver who is signed in (avoids an import cycle). */
export function setNamesSelf(fn: () => SelfLike): void {
  selfRef = fn;
}

async function start(): Promise<NameResolver> {
  if (resolver) return resolver;
  if (starting) return starting;
  starting = (async () => {
    const [{ getHolosphere }, { lookupHolonName }] = await Promise.all([
      import("$lib/holosphere"),
      import("$lib/hns"),
    ]);
    const hs = await getHolosphere();
    const r = createNameResolver(hs, {
      holon: get(holonId),
      hns: (id) => lookupHolonName(hs, id),
      self: () => selfRef(),
      format: { lastName: "initial" },
    });
    r.subscribe((m) => names.set(m));
    resolver = r;
    // Wired here, not at module load: `$lib/stores` imports `$lib/data`,
    // which imports this file — a store touched during evaluation is undefined.
    holonId.subscribe((hid) => r.setHolon(hid));
    partnerNames.subscribe((m) => r.prime(Object.entries(m)));
    shiftNames.subscribe((m) => r.prime(m));
    if (pending.size) {
      const ids = [...pending];
      pending.clear();
      void r.resolve(ids);
    }
    return r;
  })();
  return starting;
}

/** The signed-in person's own name, when `id` is theirs. */
function selfName(id: string): string {
  const me = selfRef();
  if (!me || normalizeId(me.id) !== id) return "";
  return userName(me, { lastName: "initial", idFallback: false, unknown: "" });
}

/**
 * The name for an id right now: known → the name; unknown → `shortId`, and
 * the id is queued so the next render has it. Sync, for code outside templates.
 */
export function nameFor(id: string | number | null | undefined): string {
  const n = normalizeId(id);
  if (!n) return "";
  const me = selfName(n);
  if (me) return me;
  if (resolver) return resolver.nameOf(n);
  const known = get(names).get(n);
  if (known) return known;
  pending.add(n);
  void start();
  return shortId(n);
}

/**
 * `$nameOf(id)` in a template: re-evaluates as names arrive. Subscribes to
 * the store lazily — this module is reached from `$lib/stores` through
 * `$lib/data` while `stores` is still evaluating, so a `derived()` here
 * would see an uninitialised store.
 */
export const nameOf: Readable<
  (id: string | number | null | undefined) => string
> = {
  subscribe(run) {
    return names.subscribe((m) =>
      run((id) => {
        const n = normalizeId(id);
        if (!n) return "";
        return selfName(n) || m.get(n) || nameFor(n);
      }),
    );
  },
};

/** Resolve now (awaitable); the map holds every id given, named or short. */
export async function resolveNames(
  ids: Iterable<string | number>,
): Promise<Map<string, string>> {
  const r = await start();
  return r.resolve(ids);
}

/** The kind-0 profile learned for a key (picture, about…), if any. */
export function profileFor(
  id: string | number | null | undefined,
): ProfileMeta | undefined {
  return resolver?.profileOf(id);
}

/** Names the surface already holds (a federation snapshot, a chat title…). */
export function primeNames(
  entries: Iterable<readonly [string | number, string | null | undefined]>,
): void {
  const list = [...entries];
  if (resolver) resolver.prime(list);
  else {
    names.update((m) => {
      const next = new Map(m);
      for (const [id, name] of list) {
        const n = normalizeId(id);
        if (n && name && String(name).trim()) next.set(n, String(name).trim());
      }
      return next;
    });
  }
}

/** Forget what was learned about an id (after the person edits their profile). */
export function invalidateName(id?: string | number): void {
  resolver?.invalidate(id);
  if (id === undefined) names.set(new Map());
  else
    names.update((m) => {
      const next = new Map(m);
      next.delete(normalizeId(id));
      return next;
    });
}

/** Whether `name` is only the short form of `id` — nothing was learned. */
export function isShortName(
  name: string,
  id: string | number | null | undefined,
): boolean {
  return !name || name === shortId(id);
}
