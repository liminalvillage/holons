// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Holosphere bootstrap for Flows — the wequest shape: one shared instance
// built through the core factory (the only place the constructor may be
// invoked) and a persistent per-device signing key. Flows mostly reads; the
// one thing it writes is a person's own payout address, signed by the key
// they signed in with (`sessionKey.ts`) or, failing that, this device's.

import { createHoloSphere } from "@holons/core/holosphere";
import type { HoloSphere } from "holosphere";
import { resolveAppName, resolveEnforceReads, resolveRelays } from "./config";

const DEVICE_KEY = "flows_device_key";

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
    // The relays are the wire; the local IndexedDB store paints instantly on
    // reload and survives a flaky network.
    instance = createHoloSphere({
      appName: resolveAppName(),
      privateKey: deviceKeyHex(),
      relays: resolveRelays(),
      store: { adapter: "indexeddb" },
      // Authorized reads: a snapshot is shown only when an author the Pot
      // accepts published it (VITE_HOLOSPHERE_ENFORCE=off opts out).
      enforce: resolveEnforceReads(),
      awaitReady: true,
    });
    // Dev-only console/smoke-test hook.
    if (import.meta.env.DEV && typeof window !== "undefined") {
      instance.then((hs) => ((window as any).__flows = hs));
    }
  }
  return instance;
}
