// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Holosphere bootstrap for the entrance kiosk.
//
// The kiosk reads live, and — once someone is logged in with Telegram — writes
// edits back. It holds a persistent *device* key (generated once, kept in
// localStorage) purely to sign writes; the acting identity recorded on each
// write is the logged-in Telegram user (see auth.ts `actingAs`), mirroring how
// the bot writes on behalf of chat members. The instance is built through the
// shared core factory — the one place the constructor may be invoked.

import {
  createHoloSphere,
  createHolonWriter,
  type HolonWriter,
} from "@holons/core/holosphere";
import type { HoloSphere } from "holosphere";
import type { LibraryDB } from "@holons/core/library";
import type { ChecklistStore } from "@holons/core/checklists";
import { Buffer } from "buffer";
import { resolveAppName, resolvePeers } from "./config";
import { actingAs } from "./auth";
import { lookupHolonName } from "./hns";

// Holosphere/Gun reach for a Node-ish Buffer; make sure one exists in-browser
// before the library loads.
if (typeof globalThis !== "undefined" && !(globalThis as any).Buffer) {
  (globalThis as any).Buffer = Buffer;
}

const DEVICE_KEY = "kiosk_device_key";

/** A stable per-device signing key (32 random bytes, hex). Created on demand. */
function deviceKeyHex(): string {
  let k: string | null = null;
  try {
    k = localStorage.getItem(DEVICE_KEY);
  } catch {
    /* ignore */
  }
  if (!k || !/^[0-9a-f]{64}$/i.test(k)) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    k = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    try {
      localStorage.setItem(DEVICE_KEY, k);
    } catch {
      /* private mode — key is then ephemeral for this session */
    }
  }
  return k;
}

let instance: Promise<HoloSphere> | null = null;

/** Build (once) and return the shared HoloSphere instance. */
export function getHolosphere(): Promise<HoloSphere> {
  if (!instance) {
    // Promise.resolve normalises the factory's overloaded return type.
    instance = Promise.resolve(
      createHoloSphere({
        appName: resolveAppName(),
        privateKey: deviceKeyHex(),
        logLevel: "ERROR",
        awaitReady: true,
        // Read from the production Gun relay (overridable via VITE_KIOSK_PEER).
        // Must go through `gunOptions` — the v2 config constructor only honors
        // `gunOptions.peers` / `nostr.relays`; a top-level `peers` key is
        // silently dropped and the instance falls back to the built-in default.
        extra: { gunOptions: { peers: resolvePeers() } },
      }),
    );
    // Dev-only: expose the instance so the kiosk can be poked from the console
    // (and from headless smoke tests). Tree-shaken out of production builds.
    if (import.meta.env.DEV && typeof window !== "undefined") {
      instance.then((hs) => ((window as any).__kiosk = hs));
    }
  }
  return instance;
}

// Session cache of holon-id → display name. Only *resolved* names are cached;
// an unresolved holon is left out so a later call (e.g. after its data has
// replicated) can retry.
const holonNameCache = new Map<string, string>();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// One resolution attempt. Tries, in order:
//   1. HNS — a global, signed, federation-free name table.
//   2. The holon's own `settings/<id>` record — the source holosphere itself
//      uses; it may come back as an object OR an array of entries, so handle
//      both (the array case is why partner names previously read as ids).
// Returns "" when nothing is found yet.
async function resolveHolonName(
  hs: HoloSphere,
  holonId: string,
): Promise<string> {
  try {
    const hns = await lookupHolonName(hs, holonId);
    if (hns && hns.trim()) return hns;
  } catch {
    /* fall through to settings */
  }
  try {
    const s: any = await hs.get(holonId, "settings", holonId);
    const raw = Array.isArray(s) ? s.find((e: any) => e?.name)?.name : s?.name;
    if (raw && String(raw).trim()) return String(raw);
  } catch {
    /* no name available yet */
  }
  return "";
}

/**
 * Resolve a holon's friendly name, then cache it for the session. Returns ""
 * when no name can be read (caller falls back to the id).
 *
 * A federation partner's settings/HNS replicate shortly *after* we subscribe
 * to it, so a single immediate read often races and misses — we retry a few
 * times with backoff before giving up. Only positive results are cached.
 */
export async function getHolonName(
  hs: HoloSphere,
  holonId: string,
): Promise<string> {
  const cached = holonNameCache.get(holonId);
  if (cached) return cached;

  for (const delay of [0, 800, 2000]) {
    if (delay) await sleep(delay);
    const name = await resolveHolonName(hs, holonId);
    if (name) {
      holonNameCache.set(holonId, name);
      return name;
    }
  }
  return "";
}

/** A `{ unsubscribe }` shape, tolerant of older promise-returning builds. */
export interface Subscription {
  unsubscribe: () => void;
}

/** Normalise a `holosphere.subscribe` return so teardown never throws. */
function normalizeSub(raw: unknown): Subscription {
  if (raw && typeof (raw as any).unsubscribe === "function") {
    return raw as Subscription;
  }
  if (raw && typeof (raw as any).then === "function") {
    let resolved: Subscription | null = null;
    let cancelled = false;
    (raw as PromiseLike<Subscription>).then(
      (s) => {
        resolved = s;
        if (cancelled) s?.unsubscribe?.();
      },
      () => {},
    );
    return {
      unsubscribe: () => {
        cancelled = true;
        resolved?.unsubscribe?.();
      },
    };
  }
  return { unsubscribe: () => {} };
}

/**
 * Subscribe to every key in a holon's lens, accumulating items into a Map keyed
 * by their `id` (falling back to the Gun key). `null` payloads are deletions.
 * `onChange` fires after each mutation with a fresh array snapshot.
 */
export function subscribeLens<T extends { id?: string | number }>(
  holosphere: HoloSphere,
  holonId: string,
  lens: string,
  onChange: (items: T[]) => void,
): Subscription {
  const items = new Map<string, T>();

  const emit = () => onChange([...items.values()]);
  // Fire once immediately so empty lenses still clear any "loading" state.
  emit();

  const raw = holosphere.subscribe(holonId, lens, (data: any, key?: string) => {
    const id = String((data && (data.id ?? key)) ?? key ?? "");
    if (!id) return;
    if (data == null || data._deleted) {
      items.delete(id);
    } else {
      items.set(id, data as T);
    }
    emit();
  });

  return normalizeSub(raw);
}

// NOTE: federation aggregation used to live here as `createLensAggregator`
// (which tagged partner items with a bespoke `_holon` marker). That job now
// belongs to HoloSphere's `subscribeFederated`, which folds in per-lens inbound
// partners and stamps the canonical `_federation` envelope — one aggregated read
// path shared by every surface. `+layout.svelte` subscribes through it directly.

/**
 * An identity-aware writer bound to a holon. Every `put` attaches the logged-in
 * Telegram user as `actingAs` and resolves `false` (instead of throwing) when a
 * write is denied — so callers can surface a friendly message.
 */
/**
 * Announce a successful local write so the layout's write-echo watchdog can
 * verify the live subscription actually heard it (see `lensEmitAt` in
 * stores.ts). Every write path funnels through here. `at` must be captured
 * BEFORE the put starts: Gun fires the local echo during the put, ahead of
 * the ack, so a post-ack timestamp would always outrun the echo and read as
 * "no echo" — a false stall on every healthy write.
 */
function announceWrite(holon: string, lens: string, at: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("kiosk:write", { detail: { holon, lens, at } }),
  );
}

export async function getWriter(
  holonId: string,
  onDenied?: (message: string) => void,
): Promise<HolonWriter> {
  const hs = await getHolosphere();
  const writer = createHolonWriter(hs, holonId, {
    actingAs,
    onDenied: onDenied ? (info) => onDenied(info.message) : undefined,
  });
  return {
    ...writer,
    put: async (lens, data, opts) => {
      const at = Date.now();
      const ok = await writer.put(lens, data, opts);
      if (ok) announceWrite(holonId, lens, at);
      return ok;
    },
  };
}

/**
 * A `LibraryDB` adapter over Holosphere so core's `borrowItem` / `returnItem`
 * own the meaning of lending. Writes route through `actingAs` for identity.
 */
export async function getLibraryDb(): Promise<LibraryDB> {
  const hs = await getHolosphere();
  return {
    get: (holon, lens, key) =>
      key != null ? hs.get(holon, lens, key) : hs.get(holon, lens),
    getAll: (holon, lens) => hs.getAll(holon, lens),
    put: async (holon, lens, data) => {
      const at = Date.now();
      const res = await hs.put(
        holon,
        lens,
        data as object,
        {
          actingAs: actingAs(),
        } as any,
      );
      announceWrite(holon, lens, at);
      return res;
    },
    delete: (holon, lens, key) => hs.delete(holon, lens, key),
  };
}

/**
 * A `ChecklistStore` adapter over Holosphere so core's checklist CRUD owns the
 * meaning of lists. Writes carry the logged-in Telegram user as `actingAs` and
 * announce themselves to the write-echo watchdog, like every other write path.
 */
export async function getChecklistStore(): Promise<ChecklistStore> {
  const hs = await getHolosphere();
  return {
    get: (holon, bucket, key) => hs.get(holon, bucket, key),
    getAll: (holon, bucket) => hs.getAll(holon, bucket),
    put: async (holon, bucket, value) => {
      const at = Date.now();
      const res = await hs.put(
        holon,
        bucket,
        value as object,
        {
          actingAs: actingAs(),
        } as any,
      );
      announceWrite(holon, bucket, at);
      return res;
    },
    delete: (holon, bucket, key) => hs.delete(holon, bucket, key),
  };
}

/** Shape core's REA/completion helpers expect (`put(holon, bucket, value)`). */
export interface ReaStore {
  put: (holon: string, bucket: string, value: unknown) => Promise<unknown>;
  get: (
    holon: string,
    bucket: string,
    key?: string | number,
  ) => Promise<unknown>;
}

/**
 * A generic `HoloSphereLike` store for `@holons/core`'s REA/completion
 * functions, with the logged-in Telegram user attached as `actingAs` on every
 * write — so REA events, expenses, and the completed task are all recorded
 * under the right actor.
 */
export async function getReaStore(): Promise<ReaStore> {
  const hs = await getHolosphere();
  return {
    put: async (holon, bucket, value) => {
      const at = Date.now();
      const res = await hs.put(
        holon,
        bucket,
        value as object,
        {
          actingAs: actingAs(),
        } as any,
      );
      announceWrite(holon, bucket, at);
      return res;
    },
    get: (holon, bucket, key) =>
      key != null ? hs.get(holon, bucket, String(key)) : hs.get(holon, bucket),
  };
}
