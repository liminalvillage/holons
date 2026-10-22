// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The shopping list is demand. Whatever is still to buy is a standing need,
 * kept in step with the list: one need per open item, raised the moment the
 * item is written, closed as fulfilled when the item is checked off,
 * cancelled when the item leaves the list before anyone answered.
 *
 * The twin of `offers/surplus.ts` (a shelf's surplus is a standing offer):
 * automatic behind a per-holon switch, `settings.shopping.autoNeed`, the
 * demand side's one outbound publish without a tap. Off, it only takes back
 * what it raised and nobody answered — a need with responses is somebody's
 * plan and stays.
 */

import type { HoloSphere } from 'holosphere';
import type { QuestInitiator } from '../tasks/types.js';
import { needIdOf, normalizeChecklist, stampNeedId, withItemIds } from '../shopping/operations.js';
import { SHOPPING_KEY, type ShoppingChecklist, type ShoppingItem } from '../shopping/types.js';
import { holonOf } from '../offers/supply.js';
import { closeNeed } from './responses.js';
import { publishNeedNearby, refreshPublishedNeed, type PublishNeedOptions } from './publish.js';
import { needFromShoppingItem, normalizeNeed } from './transform.js';
import { NEED_RECORD_LENS, OPEN_NEED_STATUSES, type NeedStatus, type PublishedNeed } from './types.js';

export interface ShoppingNeedsInput {
  holonId: string;
  list: ShoppingChecklist | null;
  /** The holon's own quests (non-needs are skipped). */
  needs: unknown[];
  initiator: QuestInitiator;
  now?: number;
}

export interface ShoppingNeedsPlan {
  create: PublishedNeed[];
  /** Needs to close, with the outcome: fulfilled (bought) or cancelled (taken back). */
  close: { need: PublishedNeed; outcome: 'fulfilled' | 'cancelled' }[];
  /** Needs already in step with the list. */
  keep: PublishedNeed[];
  /** The list with its stamps brought in step, or null when nothing changed. */
  list: ShoppingChecklist | null;
}

/** The deterministic id of the need raised for an item; a suffix when that id was used before. */
export function shoppingNeedId(itemId: string | number, taken: ReadonlySet<string> = new Set()): string {
  const base = `need-shop-${String(itemId)}`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Raised by the sync, still unanswered: the sync may take it back. */
function isTakeBackable(need: PublishedNeed): boolean {
  return (
    need.source?.kind === 'shopping' &&
    need.source.auto === true &&
    need.status === 'requested' &&
    !(need.responses ?? []).length &&
    !need.claimedResponseId
  );
}

/**
 * The writes that bring the holon's needs in step with its shopping list.
 * Pure: nothing is persisted. `enabled: false` plans take-backs only —
 * and, switch or no switch, a checked-off item still fulfils its need.
 */
export function shoppingNeeds(input: ShoppingNeedsInput, enabled = true): ShoppingNeedsPlan {
  const now = input.now ?? Date.now();
  const plan: ShoppingNeedsPlan = { create: [], close: [], keep: [], list: null };
  const byId = new Map<string, PublishedNeed>();
  const taken = new Set<string>();
  for (const raw of input.needs ?? []) {
    const id = (raw as { id?: unknown } | null)?.id;
    if (id != null) taken.add(String(id));
    const n = normalizeNeed(raw);
    if (n) byId.set(String(n.id), n);
  }
  const isOpen = (n: PublishedNeed | undefined): n is PublishedNeed => !!n && OPEN_NEED_STATUSES.includes(n.status);

  let list = input.list;
  const onList = new Set<string>();
  for (const item of list?.items ?? []) {
    const itemId = String(item.id);
    onList.add(itemId);
    const needId = needIdOf(item);
    const current = needId ? byId.get(needId) : undefined;

    if (item.checked) {
      // Bought: the need it carried is met (claimed included — the handoff
      // happened, or the requester found it elsewhere; either way it is over).
      if (current && (current.status === 'claimed' || isOpen(current))) {
        const closed = closeNeed(current, 'fulfilled', now);
        if (closed.ok) plan.close.push({ need: closed.need, outcome: 'fulfilled' });
      }
      continue;
    }

    if (!enabled) {
      if (current && isTakeBackable(current)) {
        const closed = closeNeed(current, 'cancelled', now);
        if (closed.ok) {
          plan.close.push({ need: closed.need, outcome: 'cancelled' });
          list = unstamp(list, item.id);
        }
      } else if (current && isOpen(current)) {
        plan.keep.push(current);
      }
      continue;
    }

    if (isOpen(current)) {
      plan.keep.push(current);
      continue;
    }
    // Nothing standing for this item: raise a need. A stale stamp (need
    // closed or gone) is replaced.
    const id = shoppingNeedId(item.id, taken);
    taken.add(id);
    const need = needFromShoppingItem(item, {
      holonId: input.holonId,
      initiator: input.initiator,
      id,
      now,
      demand: demandOfItem(item),
    });
    need.source = { kind: 'shopping', itemId: itemId, auto: true };
    plan.create.push(need);
    list = stampNeedId(list, item.id, id);
  }

  // Items that left the list before anyone answered: take the need back.
  for (const need of byId.values()) {
    if (need.source?.kind !== 'shopping' || !need.source.auto) continue;
    if (onList.has(String(need.source.itemId))) continue;
    if (!isTakeBackable(need)) continue;
    const closed = closeNeed(need, 'cancelled', now);
    if (closed.ok) plan.close.push({ need: closed.need, outcome: 'cancelled' });
  }

  plan.list = list !== input.list ? list : null;
  return plan;
}

/** The quantity a row carries, if it says one (`quantity` free field or the stock reference). */
function demandOfItem(item: ShoppingItem): { quantity?: number; unit?: string } | undefined {
  const q = (item as { quantity?: unknown }).quantity;
  if (typeof q === 'number' && Number.isFinite(q) && q > 0) {
    const u = (item as { unit?: unknown }).unit;
    return { quantity: q, ...(typeof u === 'string' && u ? { unit: u } : {}) };
  }
  const ref = (item as { stock?: { quantity?: unknown; unit?: unknown } }).stock;
  if (typeof ref?.quantity === 'number' && Number.isFinite(ref.quantity) && ref.quantity > 0) {
    return { quantity: ref.quantity, ...(typeof ref.unit === 'string' && ref.unit ? { unit: ref.unit } : {}) };
  }
  return undefined;
}

function unstamp(list: ShoppingChecklist | null, itemId: string | number): ShoppingChecklist | null {
  if (!list) return list;
  const target = String(itemId);
  return {
    ...list,
    items: list.items.map((i) => {
      if (String(i.id) !== target) return i;
      const { needId: _dropped, ...rest } = i as ShoppingItem & { needId?: unknown };
      return rest as ShoppingItem;
    }),
  };
}

export interface SyncShoppingNeedsOptions
  extends Pick<PublishNeedOptions, 'federationSourceId' | 'onWriteDenied' | 'upcastLevels'> {
  initiator: QuestInitiator;
  /** Skip the settings read and force the switch. */
  enabled?: boolean;
  /**
   * The list as just written, when the caller has it: skips the re-read,
   * which on an event-sourced store can trail the write by a beat.
   */
  list?: unknown;
  /** Where new needs go. Both default true. */
  toPartners?: boolean;
  toHex?: boolean;
  now?: number;
}

export interface SyncShoppingNeedsOutcome {
  created: PublishedNeed[];
  closed: { need: PublishedNeed; outcome: NeedStatus }[];
  errors: string[];
}

/** The per-holon switch, `settings.shopping.autoNeed`; true unless set to false. */
export async function readAutoNeedSetting(holosphere: HoloSphere, holonId: string): Promise<boolean> {
  try {
    const settings = (await (holosphere as any).get(holonId, 'settings', holonId)) as
      | { shopping?: { autoNeed?: unknown } }
      | null;
    return settings?.shopping?.autoNeed !== false;
  } catch {
    return true;
  }
}

/**
 * The hook every shopping board calls after a write: read the list and the
 * holon's needs, honour the per-holon switch, and bring the needs in step.
 * Idempotent, and never throws — a board must not fail on its side effect.
 */
export async function syncNeedsFromShopping(
  holosphere: HoloSphere,
  holonId: string,
  opts: SyncShoppingNeedsOptions,
): Promise<SyncShoppingNeedsOutcome> {
  const out: SyncShoppingNeedsOutcome = { created: [], closed: [], errors: [] };
  try {
    const hs = holosphere as any;
    const enabled = opts.enabled ?? (await readAutoNeedSetting(holosphere, holonId));
    const [rawList, quests] = await Promise.all([
      opts.list !== undefined ? opts.list : hs.get(holonId, 'checklists', SHOPPING_KEY).catch(() => null),
      hs.getAll(holonId, NEED_RECORD_LENS).catch(() => []),
    ]);
    // Rows from the generic checklists domain have no id; give them one
    // now, and write the list back even when nothing else changes.
    const withIds = withItemIds(rawList, opts.now);
    const idsAssigned = withIds !== rawList;
    const list = normalizeChecklist(withIds);
    const own = (Array.isArray(quests) ? quests : []).filter((q: unknown) => holonOf(q, holonId) === holonId);
    const plan = shoppingNeeds({ holonId, list, needs: own, initiator: opts.initiator, now: opts.now }, enabled);
    const common = { federationSourceId: opts.federationSourceId, onWriteDenied: opts.onWriteDenied };

    for (const need of plan.create) {
      try {
        const r = await publishNeedNearby(holosphere, holonId, need, {
          ...common,
          toPartners: opts.toPartners !== false,
          toHex: opts.toHex !== false,
          upcastLevels: opts.upcastLevels,
          now: opts.now,
        });
        out.created.push(r.need);
        out.errors.push(...r.errors);
      } catch (err) {
        out.errors.push(`create ${need.id}: ${(err as Error).message ?? String(err)}`);
      }
    }
    for (const { need, outcome } of plan.close) {
      try {
        const r = await refreshPublishedNeed(holosphere, holonId, need, common);
        out.closed.push({ need: r.need, outcome });
        out.errors.push(...r.errors);
      } catch (err) {
        out.errors.push(`close ${need.id}: ${(err as Error).message ?? String(err)}`);
      }
    }
    const listToWrite = plan.list ?? (idsAssigned ? list : null);
    if (listToWrite) {
      try {
        await hs.put(holonId, 'checklists', listToWrite);
      } catch (err) {
        out.errors.push(`stamp: ${(err as Error).message ?? String(err)}`);
      }
    }
  } catch (err) {
    out.errors.push(`sync: ${(err as Error).message ?? String(err)}`);
  }
  return out;
}
