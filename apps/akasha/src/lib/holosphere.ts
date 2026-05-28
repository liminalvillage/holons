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
import { resolveAppName } from "./config";
import { actingAs } from "./auth";

// Holosphere/Gun reach for a Node-ish Buffer; make sure one exists in-browser
// before the library loads.
if (typeof globalThis !== "undefined" && !(globalThis as any).Buffer) {
  (globalThis as any).Buffer = Buffer;
}

const DEVICE_KEY = "akasha_device_key";

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
      }),
    );
    // Dev-only: expose the instance so the kiosk can be poked from the console
    // (and from headless smoke tests). Tree-shaken out of production builds.
    if (import.meta.env.DEV && typeof window !== "undefined") {
      instance.then((hs) => ((window as any).__akasha = hs));
    }
  }
  return instance;
}

/** A `{ unsubscribe }` shape, tolerant of older promise-returning builds. */
export interface Subscription {
  unsubscribe: () => void;
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

  // Normalise the (rare) promise-returning build so teardown never throws.
  if (raw && typeof (raw as any).unsubscribe === "function") {
    return raw as Subscription;
  }
  if (raw && typeof (raw as any).then === "function") {
    let resolved: Subscription | null = null;
    let cancelled = false;
    (raw as unknown as PromiseLike<Subscription>).then(
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
