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
  hours: number;
  collaboration: number;
  wants: number;
  offers: number;
  /** Optional per-currency weights (currency code -> weight). */
  currencies?: Record<string, number>;
}

/**
 * Default equation weights — must match across all UIs (web, telegram, text, ai).
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
};

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
 */
async function refreshEquationCache(
  holosphere: any,
  holonId: string,
): Promise<ScoreEquation> {
  try {
    const settings = await holosphere.get(holonId, 'settings', holonId);
    if (settings?.equation) {
      const equation: ScoreEquation = { ...DEFAULT_EQUATION, ...settings.equation };
      equationCache.set(holonId, equation);
      return equation;
    }
  } catch {
    // Silently fall through to default
  }
  const defaultEq = { ...DEFAULT_EQUATION };
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
    if (settings?.equation) {
      equationCache.set(holonId, { ...DEFAULT_EQUATION, ...settings.equation });
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
