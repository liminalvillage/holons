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
import { Buffer } from "buffer";
import { resolveAppName, resolvePeers } from "./config";
import { actingAs } from "./auth";

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
        extra: { peers: resolvePeers() },
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

export interface LensAggregator {
  /** Set the exact holon set to aggregate; adds/removes subscriptions to match. */
  setHolons: (holonIds: string[]) => void;
  /** Tear down every subscription. */
  destroy: () => void;
}

/**
 * Aggregate one lens across a CHANGING set of holons (the kiosk's own holon plus
 * its federation partners). The holon set is updated live via `setHolons`
 * without dropping holons that stay — so the kiosk's own holon never blinks out
 * while the federated toggle adds or removes partners. Partner items are tagged
 * with a `_holon` source id; `selfId`'s items stay untagged. Keys are namespaced
 * by holon so identical local ids across holons don't collide.
 */
export function createLensAggregator<T extends { id?: string | number }>(
  holosphere: HoloSphere,
  lens: string,
  onChange: (items: T[]) => void,
  selfId: string,
): LensAggregator {
  const subs = new Map<string, () => void>();
  const items = new Map<string, T>();
  const emit = () => onChange([...items.values()]);

  function add(holon: string) {
    if (subs.has(holon)) return;
    const raw = holosphere.subscribe(holon, lens, (data: any, key?: string) => {
      const id = String((data && (data.id ?? key)) ?? key ?? "");
      if (!id) return;
      const k = `${holon} ${id}`;
      if (data == null || data._deleted) {
        items.delete(k);
      } else {
        items.set(
          k,
          holon === selfId ? data : ({ ...data, _holon: holon } as T),
        );
      }
      emit();
    });
    subs.set(holon, normalizeSub(raw).unsubscribe);
  }

  function remove(holon: string) {
    subs.get(holon)?.();
    subs.delete(holon);
    for (const k of [...items.keys()]) {
      if (k.startsWith(`${holon} `)) items.delete(k);
    }
  }

  return {
    setHolons(holonIds: string[]) {
      const wanted = new Set(holonIds);
      for (const holon of [...subs.keys()]) {
        if (!wanted.has(holon)) remove(holon);
      }
      for (const holon of holonIds) add(holon);
      emit();
    },
    destroy() {
      for (const un of subs.values()) un();
      subs.clear();
      items.clear();
    },
  };
}

/**
 * An identity-aware writer bound to a holon. Every `put` attaches the logged-in
 * Telegram user as `actingAs` and resolves `false` (instead of throwing) when a
 * write is denied — so callers can surface a friendly message.
 */
export async function getWriter(
  holonId: string,
  onDenied?: (message: string) => void,
): Promise<HolonWriter> {
  const hs = await getHolosphere();
  return createHolonWriter(hs, holonId, {
    actingAs,
    onDenied: onDenied ? (info) => onDenied(info.message) : undefined,
  });
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
    put: (holon, lens, data) =>
      hs.put(holon, lens, data as object, { actingAs: actingAs() } as any),
    delete: (holon, lens, key) => hs.delete(holon, lens, key),
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
    put: (holon, bucket, value) =>
      hs.put(holon, bucket, value as object, { actingAs: actingAs() } as any),
    get: (holon, bucket, key) =>
      key != null ? hs.get(holon, bucket, String(key)) : hs.get(holon, bucket),
  };
}
