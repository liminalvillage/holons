// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Scope filtering over raw lens records. The subscription layer already gates
// partner data (`includeFederated` follows the scope), but its purge after a
// networked→local flip arrives on the next re-emit; filtering here makes the
// Show pill instant. Keyed on `_federation.origin` ONLY: `_hologram` records
// are local pointers deliberately placed in this holon and must stay visible
// in every scope, even though they render with a source chip.

import type { Scope } from "./config";

/** Whether a raw record is a partner holon's copy folded in by federation. */
export function fromPartner(rec: unknown): boolean {
  return Boolean(
    (rec as { _federation?: { origin?: unknown } } | null | undefined)
      ?._federation?.origin,
  );
}

/** The records the scope allows: everything, or local-only (holograms kept). */
export function scopeLocal<T>(items: T[], scope: Scope): T[] {
  return scope === "networked" ? items : items.filter((r) => !fromPartner(r));
}
