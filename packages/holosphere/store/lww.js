// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The ONE ordering rule for a record address. Everything that used to decide
// "which write is current" — the Gun graph's HAM, the relay transport's
// created_at gate and the signing layer's `authorizedView` sort — collapses to
// this function.

/**
 * Does `candidate` replace `current` at the same address?
 *
 * Newer `created_at` wins. On a tie the larger event id wins (string compare —
 * the tie-break `signing.js` has always used), so two instances that hold the
 * same pair of events converge on the same one. Raw (unsigned, local-only)
 * writes carry an empty event id and therefore lose every tie against a signed
 * event.
 *
 * @param {{created_at:number, eventId?:string}} candidate
 * @param {{created_at:number, eventId?:string}|null|undefined} current
 */
export function wins(candidate, current) {
    if (!current) return true;
    if (candidate.created_at !== current.created_at) {
        return candidate.created_at > current.created_at;
    }
    return (candidate.eventId || '') > (current.eventId || '');
}

/** Sort comparator: newest first, ties by larger event id first. */
export function newestFirst(a, b) {
    return (b.created_at - a.created_at) || ((a.id || a.eventId || '') < (b.id || b.eventId || '') ? 1 : -1);
}
