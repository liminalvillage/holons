// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Holosphere bootstrap for WeQuest — same shape as the kiosk's: one shared
// instance built through the core factory (the only place the constructor may
// be invoked), a persistent per-device signing key, and writes that carry the
// acting user's identity.

import { createHoloSphere } from "@holons/core/holosphere";
import type { HoloSphere } from "holosphere";
import { Buffer } from "buffer";
import {
  resolveAppName,
  resolvePeers,
  resolveUserId,
  resolveUsername,
} from "./config";

// Holosphere/Gun reach for a Node-ish Buffer; make sure one exists in-browser
// before the library loads.
if (typeof globalThis !== "undefined" && !(globalThis as any).Buffer) {
  (globalThis as any).Buffer = Buffer;
}

const DEVICE_KEY = "wequest_device_key";

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
    instance = Promise.resolve(
      createHoloSphere({
        appName: resolveAppName(),
        privateKey: deviceKeyHex(),
        logLevel: "ERROR",
        awaitReady: true,
        // Must go through `gunOptions` — the v2 config constructor only honors
        // `gunOptions.peers`; a top-level `peers` key is silently dropped.
        extra: { gunOptions: { peers: resolvePeers() } },
      }),
    );
    // Dev-only console/smoke-test hook.
    if (import.meta.env.DEV && typeof window !== "undefined") {
      instance.then((hs) => ((window as any).__wequest = hs));
    }
  }
  return instance;
}

/** The acting identity attached to every write (kiosk `actingAs` pattern). */
export function actingAs(): { id: string; username?: string } | null {
  const id = resolveUserId();
  if (!id) return null;
  return { id, username: resolveUsername() || id };
}

/** Identity-stamped put. Throws on denial — callers surface a toast. */
export async function putAs(
  hs: HoloSphere,
  holon: string,
  lens: string,
  value: object,
): Promise<unknown> {
  return (hs as any).put(holon, lens, value, { actingAs: actingAs() } as any);
}
