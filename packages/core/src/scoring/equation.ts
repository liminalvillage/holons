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
 *
 * A fresh holon starts EGALITARIAN: every weight is 0, so every member scores
 * 0 and `normalizeShares` splits value equally between them. Nothing is
 * valued above anything else until the group decides it is, by raising
 * weights in the equation editor. Contributions are still recorded in the
 * REA stream regardless — the equation is a valuation, not a filter.
 *
 * The hour weight lives at `currencies.hour`; there is no top-level `hours`
 * field on freshly-created equations.
 */
export const DEFAULT_EQUATION: ScoreEquation = {
  initiated: 0,
  completed: 0,
  sent: 0,
  received: 0,
  collaboration: 0,
  participation: 0,
  coParticipants: 0,
  activity: 0,
  groupSize: 0,
  variance: 0,
  currencies: { hour: 0 },
};

// 'hours', 'wants', and 'offers' are retired weights kept here so a saved
// equation carrying them is recognized as a built-in field (and stripped on
// migration) rather than mistaken for a currency code.
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
  // Strip retired wants/offers weights so saved equations from older clients
  // don't round-trip them back into settings.
  delete (cleanRawObj as Record<string, unknown>).wants;
  delete (cleanRawObj as Record<string, unknown>).offers;

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
 * Coerce a weight coming off a form input. Blank fields arrive as `null`,
 * `''` or `NaN`; a poisoned weight would silently zero-or-NaN every score,
 * so anything non-finite settles to 0 ("this metric doesn't count here").
 */
function toWeight(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse a free-text currency entry ("euro, hour  Token") into clean codes,
 * dropping blanks, duplicates and anything the holon already knows about.
 *
 * Codes are lowercased so `Euro` and `euro` can never become two currencies
 * with two different weights.
 */
export function parseCurrencyCodes(
  input: string,
  existing: Iterable<string> = [],
): string[] {
  const known = new Set(
    [...existing].map((c) => String(c).trim().toLowerCase()).filter(Boolean),
  );
  const out: string[] = [];
  for (const raw of String(input ?? '').split(/[,\s]+/)) {
    const code = raw.trim().toLowerCase();
    if (!code || known.has(code)) continue;
    known.add(code);
    out.push(code);
  }
  return out;
}

/**
 * Persist a holon's value equation to `settings.valueEquation`.
 *
 * The equation is a group decision, so every surface that lets people edit it
 * (kiosk, dashboard, bot) writes through here: weights are coerced to finite
 * numbers, migrated to the canonical shape (no top-level `hours`, currencies
 * folded into `currencies`), merged into the existing settings document, and
 * the cache is primed so the next `getCachedEquation` already agrees.
 *
 * `id` is stamped so the record collides with the bot's settings doc (read via
 * `get(holonId, 'settings', holonId)`) instead of forking a second one.
 *
 * Returns the equation as it was actually stored.
 */
export async function saveEquation(
  holosphere: any,
  holonId: string,
  equation: ScoreEquation,
): Promise<ScoreEquation> {
  const migrated = migrateEquation(equation);
  const currencies: Record<string, number> = {};
  for (const [code, weight] of Object.entries(migrated.currencies ?? {})) {
    currencies[code] = toWeight(weight);
  }
  const clean: ScoreEquation = {
    ...migrated,
    initiated: toWeight(migrated.initiated),
    completed: toWeight(migrated.completed),
    sent: toWeight(migrated.sent),
    received: toWeight(migrated.received),
    collaboration: toWeight(migrated.collaboration),
    participation: toWeight(migrated.participation),
    coParticipants: toWeight(migrated.coParticipants),
    activity: toWeight(migrated.activity),
    groupSize: toWeight(migrated.groupSize),
    variance: toWeight(migrated.variance),
    currencies,
  };

  let existing: any = null;
  try {
    existing = await holosphere.get(String(holonId), 'settings', String(holonId));
  } catch {
    // A failed read must not cost the group its edit: fall back to writing a
    // settings document that carries the equation alone.
  }
  // The holon's currency list (`settings.currencies`, what the expense UIs
  // offer) is kept in step with the weights: a currency someone weighted here
  // is a currency the holon uses. Existing order is preserved.
  const listed = Array.isArray((existing as any)?.currencies)
    ? ((existing as any).currencies as unknown[]).map((c) => String(c))
    : [];
  const seen = new Set(listed.map((c) => c.toLowerCase()));
  for (const code of Object.keys(clean.currencies)) {
    if (!seen.has(code.toLowerCase())) {
      seen.add(code.toLowerCase());
      listed.push(code);
    }
  }

  await holosphere.put(String(holonId), 'settings', {
    ...(existing ?? {}),
    id: String(holonId),
    currencies: listed,
    valueEquation: clean,
  });
  equationCache.set(holonId, clean);
  return clean;
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
