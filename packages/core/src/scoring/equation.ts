/**
 * Value equation: weights applied to each user aggregate to compute a score.
 *
 * Equations may be customized per-holon via holosphere settings; cached
 * synchronously for instant access by UI code.
 */

export interface ScoreEquation {
  initiated: number;
  completed: number;
  sent: number;
  received: number;
  /**
   * @deprecated Top-level hours weight; new code reads
   * `currencies.hour` instead. `migrateEquation()` folds this into
   * `currencies.hour` on load. Kept readable for unmigrated callers.
   */
  hours: number;
  collaboration: number;
  wants: number;
  offers: number;
  /** Per-currency weights (currency code -> weight). */
  currencies: Record<string, number>;
}

/**
 * Default equation weights — must match across all UIs (web, telegram, text, ai).
 * `currencies.hour: 1` mirrors the legacy `hours: 1` so existing time-tracking
 * data scores identically whether read via `aggregates.hours * equation.hours`
 * or via `currencyBalances.hour * equation.currencies.hour`.
 */
export const DEFAULT_EQUATION: ScoreEquation = {
  initiated: 1,
  completed: 2, // Completing is worth 2x more than initiating
  sent: 1,
  received: 1,
  hours: 1,
  collaboration: 1,
  wants: 1,
  offers: 1,
  currencies: { hour: 1 },
};

const BUILT_IN_EQUATION_KEYS = new Set<keyof ScoreEquation>([
  'initiated',
  'completed',
  'sent',
  'received',
  'hours',
  'collaboration',
  'wants',
  'offers',
  'currencies',
]);

/**
 * Fold legacy `equation.hours` into `equation.currencies.hour` and ensure
 * `currencies` is an object. Idempotent — safe to call on already-migrated
 * data. Returns a new object; does not mutate the input.
 *
 * Also folds flat per-currency keys (e.g. `valueEquation.euro = 0`) — the
 * shape telegram-ui historically wrote — into `currencies.euro`. Anything
 * top-level numeric that isn't a known built-in equation field is treated
 * as a currency weight.
 *
 * After migration the equation still carries `hours` (set to the same value
 * as `currencies.hour`) so consumers that haven't been updated yet keep
 * computing the same score. New code should read `currencies.hour`.
 */
export function migrateEquation(raw: any): ScoreEquation {
  const rawObj = raw ?? {};

  // Pull legacy hours and raw currencies from the input, ignoring defaults —
  // otherwise DEFAULT_EQUATION.currencies.hour would shadow the legacy
  // `hours` field on un-migrated data.
  const legacyHours = typeof rawObj.hours === 'number' ? rawObj.hours : null;
  const rawCurrencies =
    rawObj.currencies && typeof rawObj.currencies === 'object'
      ? ({ ...rawObj.currencies } as Record<string, number>)
      : null;

  const currencies: Record<string, number> = rawCurrencies ?? {};

  // Fold flat top-level per-currency keys into the currencies sub-map.
  // An explicit currencies entry wins over the legacy flat key.
  const cleanRawObj: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawObj)) {
    if (BUILT_IN_EQUATION_KEYS.has(key as keyof ScoreEquation)) {
      cleanRawObj[key] = value;
      continue;
    }
    if (typeof value === 'number' && currencies[key] === undefined) {
      currencies[key] = value;
    }
  }

  if (!(currencies.hour > 0)) {
    if (legacyHours !== null && legacyHours > 0) {
      currencies.hour = legacyHours;
    } else if (rawCurrencies === null) {
      // No raw currencies, no legacy hours — apply the default.
      currencies.hour = DEFAULT_EQUATION.currencies.hour ?? 0;
    }
    // If rawCurrencies is set but lacks hour, leave it absent: an empty
    // currencies map is a valid "disable hours" signal.
  }

  return {
    ...DEFAULT_EQUATION,
    ...cleanRawObj,
    currencies,
    // Mirror currencies.hour back so legacy `equation.hours` readers stay correct.
    hours: currencies.hour ?? 0,
  } as ScoreEquation;
}

// Per-holon equation cache for instant synchronous access.
const equationCache = new Map<string, ScoreEquation>();
const equationSubscriptions = new Map<string, () => void>();

/**
 * Get cached equation synchronously (returns default if not cached).
 */
export function getCachedEquation(holonId: string): ScoreEquation {
  return equationCache.get(holonId) || { ...DEFAULT_EQUATION };
}

/**
 * Load equation from holosphere settings with caching.
 * Returns cached value immediately if available; otherwise fetches.
 * Either way, refreshes the cache in the background.
 */
export async function loadEquation(
  holosphere: any,
  holonId: string,
): Promise<ScoreEquation> {
  const cached = equationCache.get(holonId);
  if (cached) {
    // Refresh in background (fire and forget)
    refreshEquationCache(holosphere, holonId).catch(() => {});
    return cached;
  }
  return refreshEquationCache(holosphere, holonId);
}

/**
 * Refresh equation cache from holosphere settings.
 *
 * Reads `settings.valueEquation` (new) or `settings.equation` (legacy),
 * runs `migrateEquation()` so callers always see `currencies.hour` set.
 */
async function refreshEquationCache(
  holosphere: any,
  holonId: string,
): Promise<ScoreEquation> {
  try {
    const settings = await holosphere.get(holonId, 'settings', holonId);
    const raw = settings?.valueEquation ?? settings?.equation;
    if (raw) {
      const equation = migrateEquation(raw);
      equationCache.set(holonId, equation);
      return equation;
    }
  } catch {
    // Silently fall through to default
  }
  const defaultEq = migrateEquation(undefined);
  equationCache.set(holonId, defaultEq);
  return defaultEq;
}

/**
 * Subscribe to settings changes to keep the equation cache fresh.
 * Call this once per holon (e.g. in app layout or holon context init).
 */
export function subscribeToEquationChanges(
  holosphere: any,
  holonId: string,
): () => void {
  const existing = equationSubscriptions.get(holonId);
  if (existing) return existing;

  const unsub = holosphere.subscribe(holonId, 'settings', (settings: any) => {
    const raw = settings?.valueEquation ?? settings?.equation;
    if (raw) {
      equationCache.set(holonId, migrateEquation(raw));
    }
  });

  const unsubscribe = () => {
    if (unsub?.unsubscribe) unsub.unsubscribe();
    else if (typeof unsub === 'function') unsub();
    equationSubscriptions.delete(holonId);
  };

  equationSubscriptions.set(holonId, unsubscribe);
  return unsubscribe;
}

/**
 * Preload equation for a holon (call during app init or navigation).
 */
export async function preloadEquation(
  holosphere: any,
  holonId: string,
): Promise<void> {
  await refreshEquationCache(holosphere, holonId);
}
