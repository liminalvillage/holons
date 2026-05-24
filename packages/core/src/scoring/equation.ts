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
   * @deprecated Read-only fallback for unmigrated holons. The canonical
   * hour weight lives at `currencies.hour`. `migrateEquation()` folds any
   * top-level `hours` into `currencies.hour` and never emits it back, so
   * fresh saves don't carry this field at all. Scoring code keeps the
   * fallback so already-saved equations from older clients still compute.
   */
  hours?: number;
  collaboration: number;
  wants: number;
  offers: number;
  /**
   * Collaboration signals (REA-derived):
   *  - participation: # distinct quests touched
   *  - coParticipants: # distinct other agents in those quests
   *  - activity: total event count (provider or receiver)
   *  - groupSize: mean group size across the user's quests
   *  - variance: variance of group size across the user's quests
   *
   * All optional — equations that predate the addition score them as 0.
   */
  participation?: number;
  coParticipants?: number;
  activity?: number;
  groupSize?: number;
  variance?: number;
  /** Per-currency weights (currency code -> weight). */
  currencies: Record<string, number>;
}

/**
 * Default equation weights — must match across all UIs (web, telegram, text, ai).
 * The hour weight lives at `currencies.hour`; there is no top-level `hours`
 * field on freshly-created equations.
 */
export const DEFAULT_EQUATION: ScoreEquation = {
  initiated: 1,
  completed: 2, // Completing is worth 2x more than initiating
  sent: 1,
  received: 1,
  collaboration: 1,
  wants: 1,
  offers: 1,
  // Collaboration signals default to 0 so a fresh holon's scores match the
  // pre-feature behaviour exactly. Holons that want to reward teamwork
  // raise these via the equation editor.
  participation: 0,
  coParticipants: 0,
  activity: 0,
  groupSize: 0,
  variance: 0,
  currencies: { hour: 1 },
};

const BUILT_IN_EQUATION_KEYS = new Set<string>([
  'initiated',
  'completed',
  'sent',
  'received',
  'hours',
  'collaboration',
  'wants',
  'offers',
  'participation',
  'coParticipants',
  'activity',
  'groupSize',
  'variance',
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
 * The output never contains a top-level `hours` field: the canonical
 * hour weight lives at `currencies.hour`. Legacy `hours` on the input is
 * folded into `currencies.hour` (when an explicit currencies entry isn't
 * already there) and otherwise discarded.
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
    if (BUILT_IN_EQUATION_KEYS.has(key)) {
      cleanRawObj[key] = value;
      continue;
    }
    if (typeof value === 'number' && currencies[key] === undefined) {
      currencies[key] = value;
    }
  }

  if (currencies.hour === undefined) {
    if (legacyHours !== null) {
      currencies.hour = legacyHours;
    } else if (rawCurrencies === null) {
      // No raw currencies, no legacy hours — apply the default.
      currencies.hour = DEFAULT_EQUATION.currencies.hour ?? 0;
    }
    // If rawCurrencies is set but lacks hour, leave it absent: an empty
    // currencies map is a valid "disable hours" signal.
  }

  // Strip the legacy top-level `hours` from the output. The canonical
  // hour weight is `currencies.hour`. Leaving it would let stale data
  // round-trip back into settings on save.
  delete (cleanRawObj as Record<string, unknown>).hours;

  return {
    ...DEFAULT_EQUATION_NO_HOURS,
    ...cleanRawObj,
    currencies,
  } as ScoreEquation;
}

// DEFAULT_EQUATION minus the (already-absent) `hours` field. Kept as a
// separate constant so migrateEquation's output shape is explicit about
// the omission and a stray `hours: 1` on a future DEFAULT_EQUATION edit
// won't silently leak back into saved data.
const { hours: _legacyDefaultHours, ...DEFAULT_EQUATION_NO_HOURS } =
  DEFAULT_EQUATION as ScoreEquation & { hours?: number };

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

  const sub = holosphere.subscribe(holonId, 'settings', (settings: any) => {
    const raw = settings?.valueEquation ?? settings?.equation;
    if (raw) {
      equationCache.set(holonId, migrateEquation(raw));
    }
  });

  const unsubscribe = () => {
    sub.unsubscribe();
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
