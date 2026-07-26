// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Provenance of federated / hologram records.
 *
 * Records aggregated across holons carry `_hologram` (a resolved pointer into
 * the source holon's graph) or `_federation` (a partner-published copy) tags.
 * A write that must land on the real record — borrow/return/edit — has to
 * target the source holon and key, or it forks a stray local copy that
 * unlinks from the original. These helpers extract that target; extracted
 * from apps/kiosk `$lib/data.ts` so every surface shares one rule.
 */

/** The holon a foreign record actually lives in, or `undefined` if local. */
export function sourceHolonId(rec: unknown): string | undefined {
  const r = rec as {
    _hologram?: { isHologram?: boolean; sourceHolon?: string };
    _federation?: { origin?: string };
  };
  if (r?._hologram?.isHologram && r._hologram.sourceHolon) return r._hologram.sourceHolon;
  if (r?._federation?.origin) return r._federation.origin;
  return undefined;
}

/**
 * Where a foreign record actually lives, for a write that must land in the
 * owner's graph. Returns the source `{ holon, key }`, or `undefined` for the
 * holon's own records (write them in place).
 *
 * The holon comes from {@link sourceHolonId}. The key matters for a resolved
 * hologram: its local pointer can sit under a different key than the source's
 * own (`_hologram.sourceKey` is the authoritative one parsed from the soul);
 * federated (`_federation`) partners share the id, so we fall back to
 * `localId`. This mirrors HoloSphere's own put-redirection, which rewrites a
 * write landing on a hologram to `soul.holon`/`soul.key` — we just target it
 * directly.
 */
export function sourceRef(
  rec: unknown,
  localId: string
): { holon: string; key: string } | undefined {
  const holon = sourceHolonId(rec);
  if (!holon) return undefined;
  const sourceKey = (rec as { _hologram?: { sourceKey?: string | null } })?._hologram?.sourceKey;
  return { holon, key: sourceKey || localId };
}
