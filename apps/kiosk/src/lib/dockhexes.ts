// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Where each docked holon lives: its claimed cell (`settings.hex`, the field
// the HexPicker writes). Both spheres need it, not only the earth: a holon
// with a place — or federated with one that has a place — is ANCHORED and
// floats in the sky; the rest wait in the drawer (DockView, `anchoredIds`).
//
// A cell once seen is kept across mounts (and on globalThis, so an HMR
// reload keeps it too) so flipping sky ⇄ earth is instant. A MISS is never
// kept: a partner's settings replicate a beat after we first ask, so a miss
// is retried a couple of times, and a place claimed later in Settings must
// show on the next look — the picker announces it (`kiosk:hex-changed`) so
// the store moves at once.
//
// Places are also kept on the device (lib/dockcache), so a reload anchors
// the sky on its first frame instead of letting hubs float loose until the
// relays answer. A kept place is still looked up once per session, in the
// background, and moves if the hub has moved.

import { writable, get } from "svelte/store";
import { readSettingsHex } from "@holons/core/federation";
import { readCache, writeCache } from "./dockcache";
import { getHolosphere } from "./holosphere";

const kept: Map<string, string> = ((globalThis as any).__kioskDockHexes ??=
  new Map(
    typeof window === "undefined"
      ? []
      : Object.entries(readCache<Record<string, string>>("hexes", {})).filter(
          ([, hex]) => typeof hex === "string" && hex !== "",
        ),
  ));
/** Places confirmed from the relays this session (not only remembered). */
const confirmed = new Set<string>();

/** Holon id → claimed cell, for every docked holon whose place is known. */
export const dockHexes = writable<ReadonlyMap<string, string>>(new Map(kept));

/** Record (or clear) a holon's cell. */
export function setHex(holon: string, hex: string | null | undefined): void {
  if (!holon) return;
  if (hex) {
    if (kept.get(holon) === hex) return;
    kept.set(holon, hex);
  } else {
    if (!kept.has(holon)) return;
    kept.delete(holon);
  }
  dockHexes.set(new Map(kept));
  writeCache("hexes", Object.fromEntries(kept));
}

/** The cell a holon is known to live on, or null. */
export function hexOf(holon: string): string | null {
  return get(dockHexes).get(holon) ?? null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const looking = new Map<string, Promise<string | null>>();

/**
 * Look one holon's cell up (with a short retry for a late replica). A place
 * remembered from an earlier session answers at once and is re-checked in
 * the background, once.
 */
export function lookupHex(holon: string): Promise<string | null> {
  const known = kept.get(holon);
  if (known && confirmed.has(holon)) return Promise.resolve(known);
  const busy = looking.get(holon);
  if (known) {
    if (!busy) looking.set(holon, check(holon));
    return Promise.resolve(known);
  }
  if (busy) return busy;
  const run = check(holon);
  looking.set(holon, run);
  return run;
}

async function check(holon: string): Promise<string | null> {
  const remembered = kept.has(holon);
  try {
    const hs = await getHolosphere();
    for (const delay of [0, 800, 2000]) {
      if (delay) await sleep(delay);
      const hex = await readSettingsHex(hs, holon);
      if (hex) {
        confirmed.add(holon);
        setHex(holon, hex);
        return hex;
      }
    }
    // A miss is not trusted (a replica may be late), but a remembered place
    // is not asked about again this session either.
    if (remembered) confirmed.add(holon);
  } catch {
    /* unreachable — the holon stays as it was this time */
  } finally {
    looking.delete(holon);
  }
  return kept.get(holon) ?? null;
}

/** Make sure every one of these holons' cells is (being) looked up. */
export async function ensureHexes(ids: readonly string[]): Promise<void> {
  await Promise.all(ids.filter((id) => !confirmed.has(id)).map(lookupHex));
}

// One listener for the whole app: Settings → Set location, and the dock's
// own drops, announce a move here.
if (typeof window !== "undefined") {
  window.addEventListener("kiosk:hex-changed", (ev: Event) => {
    const d = (ev as CustomEvent<{ holon?: string; hex?: string }>).detail;
    if (d?.holon) {
      confirmed.add(d.holon);
      setHex(d.holon, d.hex ?? null);
    }
  });
}
