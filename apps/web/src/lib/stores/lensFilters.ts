import { writable, type Writable } from "svelte/store";
import { browser } from "$app/environment";

const KEY = "lensFilters.shared.v1";

type Snapshot = {
  showFederated: boolean;
  showHolograms: boolean;
  showUnverified: boolean;
};

const DEFAULTS: Snapshot = {
  showFederated: false,
  showHolograms: true,
  showUnverified: false,
};

function readSnapshot(): Snapshot {
  if (!browser) return DEFAULTS;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    return {
      showFederated:
        typeof saved.showFederated === "boolean"
          ? saved.showFederated
          : DEFAULTS.showFederated,
      showHolograms:
        typeof saved.showHolograms === "boolean"
          ? saved.showHolograms
          : DEFAULTS.showHolograms,
      showUnverified:
        typeof saved.showUnverified === "boolean"
          ? saved.showUnverified
          : DEFAULTS.showUnverified,
    };
  } catch {
    return DEFAULTS;
  }
}

function writeSnapshot(patch: Partial<Snapshot>) {
  if (!browser) return;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    localStorage.setItem(KEY, JSON.stringify({ ...saved, ...patch }));
  } catch {
    /* localStorage unavailable; ignore */
  }
}

const initial = readSnapshot();

/**
 * Shared lens filter toggles. Same instance across every lens view, so
 * the user only configures these once and the choice survives navigation.
 * Persisted to localStorage under `lensFilters.shared.v1`.
 */
export const showFederated: Writable<boolean> = writable(initial.showFederated);
export const showHolograms: Writable<boolean> = writable(initial.showHolograms);
/**
 * "Show all data": when on, surfaces unsigned/legacy records (tagged
 * `_unverified`) that enforce-mode authorized-read would otherwise hide. For
 * display/migration only — never trust `_unverified` items. No-op unless
 * holosphere signing is in enforce mode (off/shadow already show everything).
 */
export const showUnverified: Writable<boolean> = writable(
  initial.showUnverified,
);

if (browser) {
  showFederated.subscribe((value) => writeSnapshot({ showFederated: value }));
  showHolograms.subscribe((value) => writeSnapshot({ showHolograms: value }));
  showUnverified.subscribe((value) => writeSnapshot({ showUnverified: value }));
}

export interface LensFilterable {
  _hologram?: { isHologram?: boolean } | null;
  _federation?: unknown;
  _unverified?: boolean;
}

/**
 * Shared visibility gate used by every lens view (tasks, expenses, offers,
 * roles, shopping, library, checklists). Keeps the toggles in lockstep
 * across lenses.
 *
 * The `_unverified` gate mirrors QueryManager.notifySubscribers so the
 * "Show all data" toggle behaves identically on the local stream and the
 * federated one-shot (getFederated): unsigned/legacy items are hidden unless
 * the toggle is on. `unverified` defaults to true (show) so callers that
 * predate the parameter keep their previous behavior.
 */
export function passesLensFilters(
  item: LensFilterable | null | undefined,
  holograms: boolean,
  federated: boolean,
  unverified: boolean = true,
): boolean {
  const isHologram = item?._hologram?.isHologram === true;
  const isFederated = !!item?._federation;
  if (!holograms && isHologram) return false;
  if (!federated && isFederated) return false;
  if (!unverified && item?._unverified === true) return false;
  return true;
}
