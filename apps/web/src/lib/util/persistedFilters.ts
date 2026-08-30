/**
 * Tiny helpers to persist a feature's filter/toolbar state across reloads.
 *
 * Shape contract: callers pass a plain object with primitive/JSON-safe values
 * (strings, numbers, booleans). Keys that aren't present in `defaults` are
 * dropped on load, so removing a field in a newer version won't poison the
 * stored state.
 *
 * Usage (Svelte 4 or 5):
 *   let filters = loadFilters('shopping', {
 *     searchQuery: '',
 *     showFederated: false,
 *     showHolograms: true,
 *   });
 *   $: saveFilters('shopping', filters);  // re-persist whenever filters changes
 */

const PREFIX = "holons_filters_";

function storageKey(feature: string): string {
  return `${PREFIX}${feature}`;
}

export function loadFilters<T extends Record<string, unknown>>(
  feature: string,
  defaults: T,
): T {
  if (typeof localStorage === "undefined") return { ...defaults };
  try {
    const raw = localStorage.getItem(storageKey(feature));
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...defaults };
    // Only adopt keys that exist in defaults — ignores legacy/unknown fields.
    const merged: Record<string, unknown> = { ...defaults };
    for (const k of Object.keys(defaults)) {
      if (k in parsed) merged[k] = parsed[k];
    }
    return merged as T;
  } catch {
    return { ...defaults };
  }
}

export function saveFilters<T extends Record<string, unknown>>(
  feature: string,
  state: T,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(feature), JSON.stringify(state));
  } catch {
    // Quota, private mode, etc. — silently ignore; filter state is not critical.
  }
}
