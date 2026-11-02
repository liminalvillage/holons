// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the dock knew last time, kept on this device so a reload paints at
// once: the people across the docked hubs, each hub's federation partners,
// where each hub lives, and where the sky's orbs stood. Every read from the
// relays waits on a catch-up (a few seconds a lens, several lenses a hub),
// and the dock used to open bare — orbs loose, then snapping into their
// constellations as partners and places arrived; the people view empty for
// half a minute. Now the last answer is drawn first and the fresh one
// replaces it quietly when it lands.
//
// Local-first in the plain sense: the same device already mirrors these
// events into IndexedDB; this is only the folded answer, per namespace (a
// scratch graph never paints the live one's people). A cache that cannot
// be read or written — private window, storage full — is simply absent.

import { resolveAppName } from "./config";
import type { OrbSim } from "./dock";

const PREFIX = "kiosk_dockcache";

function keyFor(name: string): string {
  let app = "";
  try {
    app = resolveAppName();
  } catch {
    /* no config yet: one shared slot */
  }
  return `${PREFIX}:${app}:${name}`;
}

/** The last value kept under `name`, or `fallback`. */
export function readCache<T>(name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(keyFor(name));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Keep `value` under `name`; best-effort. */
export function writeCache(name: string, value: unknown): void {
  try {
    localStorage.setItem(keyFor(name), JSON.stringify(value));
  } catch {
    /* storage full or blocked — next reload just starts bare */
  }
}

// ── Where the orbs stood ─────────────────────────────────────────────────--

/** Orb places as fractions of the field, so a resized window still fits. */
export type SkySnapshot = Record<string, [number, number]>;

/** The sim's places, as fractions of a `width` × `height` field. */
export function packSky(
  sim: Pick<OrbSim, "ids" | "px" | "py">,
  width: number,
  height: number,
): SkySnapshot {
  const out: SkySnapshot = {};
  if (!width || !height) return out;
  for (let i = 0; i < sim.ids.length; i++) {
    const x = sim.px[i] / width;
    const y = sim.py[i] / height;
    if (Number.isFinite(x) && Number.isFinite(y))
      out[sim.ids[i]] = [round(x), round(y)];
  }
  return out;
}

/**
 * Put the kept places back onto a freshly seeded sim (in place): whoever
 * was kept stands where they stood, at rest; newcomers keep their seed.
 * Returns how many were placed.
 */
export function unpackSky(
  sim: OrbSim,
  kept: SkySnapshot,
  width: number,
  height: number,
): number {
  let placed = 0;
  for (let i = 0; i < sim.ids.length; i++) {
    const at = kept[sim.ids[i]];
    if (!Array.isArray(at) || at.length !== 2) continue;
    const [x, y] = at;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sim.px[i] = clamp01(x) * width;
    sim.py[i] = clamp01(y) * height;
    sim.vx[i] = 0;
    sim.vy[i] = 0;
    placed++;
  }
  return placed;
}

const round = (v: number) => Math.round(v * 10000) / 10000;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
