// SPDX-License-Identifier: AGPL-3.0-or-later
// Tab ordering, pure: a caretaker drags the tabs of the strip into the order
// the hub reads them in, and that order persists per device. The stored
// preference is a list of ids; it may name tabs that don't exist any more or
// miss ones added since, so both helpers tolerate strangers and gaps.

/**
 * Sort `tabs` by the ids in `order`: listed tabs first, in that sequence;
 * the rest keep their default order after them. Unknown ids are ignored.
 */
export function applyTabOrder<T extends { id: string }>(
  tabs: readonly T[],
  order: readonly string[],
): T[] {
  const rank = new Map<string, number>();
  order.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i);
  });
  const listed = tabs.filter((t) => rank.has(t.id));
  const rest = tabs.filter((t) => !rank.has(t.id));
  listed.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...listed, ...rest];
}

/**
 * Fold a reorder of the VISIBLE tabs back into the full order: every slot of
 * `full` that holds one of `visible` is refilled from `visible` in sequence,
 * so hidden tabs keep their place relative to their neighbours and come back
 * where they were. The visible sequence is kept whole: ids `full` never
 * had take slots in turn, and whatever is left over goes on the end.
 */
export function mergeTabOrder(
  full: readonly string[],
  visible: readonly string[],
): string[] {
  const moving = new Set(visible);
  const queue = visible.filter((id, i) => visible.indexOf(id) === i);
  const out: string[] = [];
  for (const id of full) {
    if (moving.has(id)) {
      const next = queue.shift();
      if (next !== undefined) out.push(next);
    } else {
      out.push(id);
    }
  }
  return [...out, ...queue];
}

/** Move `id` so it sits at `index` in `ids` (a no-op if it isn't there). */
export function moveId(
  ids: readonly string[],
  id: string,
  index: number,
): string[] {
  const from = ids.indexOf(id);
  if (from === -1) return [...ids];
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
  return next;
}
