// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Scope filtering over raw lens records. The subscription layer already gates
// partner data (`includeFederated` follows the scope), but its purge after a
// networked→local flip arrives on the next re-emit; filtering here makes the
// Show federated switch instant. Keyed on `_federation.origin` ONLY: `_hologram` records
// are local pointers deliberately placed in this holon and stay visible in
// every scope — unless the Filters sheet's Holograms switch hides them.

import type { Scope } from "./config";
import { isHologram } from "./data";

/** Whether a raw record is a partner holon's copy folded in by federation. */
export function fromPartner(rec: unknown): boolean {
  return Boolean(
    (rec as { _federation?: { origin?: unknown } } | null | undefined)
      ?._federation?.origin,
  );
}

/**
 * The records the scope allows: everything, or local-only — holograms kept
 * unless `holograms` is off, whatever the scope.
 */
export function scopeLocal<T>(items: T[], scope: Scope, holograms = true): T[] {
  if (scope === "networked" && holograms) return items;
  return items.filter(
    (r) =>
      (scope === "networked" || !fromPartner(r)) &&
      (holograms || !isHologram(r)),
  );
}
