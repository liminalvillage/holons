// @holons/core/checklists — UI-agnostic CRUD + helpers for checklists.
// Authoritative source: packages/telegram-ui/src/Checklists.js (HolonsBot).
// Routes all storage through a generic ChecklistStore (Holosphere-shaped).

import {
  CHECKLIST_TYPES,
  type Checklist,
  type ChecklistItem,
  type ChecklistStore,
  type ChecklistType,
  type CreateChecklistOptions,
} from './types.js';

const BUCKET = 'checklists';

/** Build a fresh checklist record with type-specific fields. */
export function createChecklistObject(
  id: string,
  type: ChecklistType,
  options: CreateChecklistOptions = {}
): Checklist {
  const base: Checklist = {
    id,
    type,
    items: [],
    created: new Date(),
    creator: options.creator ?? null,
  };

  switch (type) {
    case CHECKLIST_TYPES.QUEST:
      return {
        ...base,
        questId: options.questId,
        parentTitle: options.parentTitle,
        holonId: options.holonId,
      };
    case CHECKLIST_TYPES.ROLE:
      return {
        ...base,
        roleId: options.roleId,
        parentTitle: options.parentTitle,
        holonId: options.holonId,
      };
    case CHECKLIST_TYPES.AGENDA:
    case CHECKLIST_TYPES.SHOPPING:
    case CHECKLIST_TYPES.CHECKLIST:
    default:
      return base;
  }
}

/**
 * Infer the {@link ChecklistType} of a legacy record that pre-dates the
 * `type` field. Mutates the record in place AND returns it so callers can
 * chain.
 */
export function migrateLegacyChecklistType(checklist: Checklist): Checklist {
  if (!checklist) return checklist;
  if (checklist.type) return checklist;

  if (checklist.id === 'agenda' || checklist.id === 'shopping') {
    checklist.type = checklist.id as ChecklistType;
  } else if (
    checklist.questId ||
    checklist.questTitle ||
    checklist.isTaskChecklist
  ) {
    checklist.type = CHECKLIST_TYPES.QUEST;
  } else if (
    checklist.roleId ||
    checklist.roleTitle ||
    checklist.isRoleChecklist
  ) {
    checklist.type = CHECKLIST_TYPES.ROLE;
  } else {
    checklist.type = CHECKLIST_TYPES.CHECKLIST;
  }
  return checklist;
}

/** Special checklists (agenda, shopping) cannot be deleted by users. */
export function isSpecialChecklist(input: Checklist | string): boolean {
  if (typeof input === 'string') {
    return input === 'agenda' || input === 'shopping';
  }
  return (
    input?.type === CHECKLIST_TYPES.AGENDA ||
    input?.type === CHECKLIST_TYPES.SHOPPING
  );
}

/** Display title — parentTitle (quest/role) wins, else uppercase id. */
export function getChecklistDisplayTitle(checklist: Checklist): string {
  if (checklist?.parentTitle) return checklist.parentTitle;
  return (checklist?.id ?? '').toUpperCase();
}

/** Type-display name used in user-facing strings. */
export function getTypeDisplayName(type: ChecklistType | undefined): string {
  switch (type) {
    case CHECKLIST_TYPES.QUEST:
      return 'task';
    case CHECKLIST_TYPES.ROLE:
      return 'role task';
    case CHECKLIST_TYPES.AGENDA:
      return 'agenda';
    case CHECKLIST_TYPES.SHOPPING:
      return 'shopping list';
    case CHECKLIST_TYPES.CHECKLIST:
    default:
      return 'checklist';
  }
}

/** Emoji icon for a checklist (accepts a record or just an id string). */
export function getChecklistIcon(input: Checklist | string): string {
  if (typeof input === 'string') {
    switch (input) {
      case 'agenda':
        return '📅';
      case 'shopping':
        return '🛒';
      default:
        return '📋';
    }
  }
  switch (input?.type) {
    case CHECKLIST_TYPES.AGENDA:
      return '📅';
    case CHECKLIST_TYPES.SHOPPING:
      return '🛒';
    case CHECKLIST_TYPES.ROLE:
      return '👥';
    case CHECKLIST_TYPES.QUEST:
    case CHECKLIST_TYPES.CHECKLIST:
    default:
      return '📋';
  }
}

/** Parse a comma-separated string into ChecklistItem[]; drops blanks. */
export function parseItemsText(itemsText: string): ChecklistItem[] {
  if (!itemsText) return [];
  return itemsText
    .split(',')
    .map((t) => ({ text: t.trim(), checked: false }))
    .filter((i) => i.text);
}

// ---------------------------------------------------------------------------
// Storage operations
// ---------------------------------------------------------------------------

const hid = (holonId: string | number) => holonId.toString();

/** Fetch a single checklist by id. Returns null if missing. */
export async function getChecklist(
  store: ChecklistStore,
  holonId: string | number,
  checklistId: string
): Promise<Checklist | null> {
  const cl = (await store.get(hid(holonId), BUCKET, checklistId)) as
    | Checklist
    | null
    | undefined;
  if (!cl) return null;
  return migrateLegacyChecklistType(cl);
}

/** Fetch all checklists; legacy records are migrated to the typed shape. */
export async function getAllChecklists(
  store: ChecklistStore,
  holonId: string | number
): Promise<Checklist[]> {
  const lists = (await store.getAll(hid(holonId), BUCKET)) ?? [];
  return (lists as Checklist[]).map(migrateLegacyChecklistType);
}

/** Persist a checklist record. */
export async function putChecklist(
  store: ChecklistStore,
  holonId: string | number,
  checklist: Checklist
): Promise<void> {
  await store.put(hid(holonId), BUCKET, checklist);
}

/** Delete a checklist by id. Refuses to delete special (agenda/shopping). */
export async function deleteChecklist(
  store: ChecklistStore,
  holonId: string | number,
  checklistId: string
): Promise<{ ok: boolean; reason?: 'special' | 'not_found' }> {
  const cl = await getChecklist(store, holonId, checklistId);
  if (cl && isSpecialChecklist(cl)) {
    return { ok: false, reason: 'special' };
  }
  await store.delete(hid(holonId), BUCKET, checklistId);
  return { ok: true };
}

/**
 * Create a checklist if it doesn't exist. Returns `{ ok: false }` when the
 * name collides or contains an underscore.
 */
export async function createChecklist(
  store: ChecklistStore,
  holonId: string | number,
  name: string,
  options: CreateChecklistOptions & { type?: ChecklistType } = {}
): Promise<
  | { ok: true; checklist: Checklist }
  | { ok: false; reason: 'invalid_name' | 'exists' }
> {
  if (!name || name.includes('_')) {
    return { ok: false, reason: 'invalid_name' };
  }
  const existing = await store.get(hid(holonId), BUCKET, name);
  if (existing) return { ok: false, reason: 'exists' };
  const type = options.type ?? CHECKLIST_TYPES.CHECKLIST;
  const checklist = createChecklistObject(name, type, options);
  await putChecklist(store, holonId, checklist);
  return { ok: true, checklist };
}

/** Append items (parsed from comma-separated text) to an existing checklist. */
export async function addItemsToChecklist(
  store: ChecklistStore,
  holonId: string | number,
  checklistId: string,
  itemsText: string
): Promise<
  | { ok: true; checklist: Checklist; added: ChecklistItem[] }
  | { ok: false; reason: 'not_found' | 'no_items' }
> {
  const checklist = await getChecklist(store, holonId, checklistId);
  if (!checklist) return { ok: false, reason: 'not_found' };
  const newItems = parseItemsText(itemsText);
  if (newItems.length === 0) return { ok: false, reason: 'no_items' };
  checklist.items.push(...newItems);
  await putChecklist(store, holonId, checklist);
  return { ok: true, checklist, added: newItems };
}

/** Append already-shaped items to an existing-or-new checklist. */
export async function appendItems(
  store: ChecklistStore,
  holonId: string | number,
  checklistId: string,
  items: ChecklistItem[],
  fallbackOptions: CreateChecklistOptions & { type?: ChecklistType } = {}
): Promise<Checklist> {
  let checklist = await getChecklist(store, holonId, checklistId);
  if (!checklist) {
    checklist = createChecklistObject(
      checklistId,
      fallbackOptions.type ?? CHECKLIST_TYPES.CHECKLIST,
      fallbackOptions
    );
  }
  if (items.length > 0) {
    checklist.items.push(...items);
    await putChecklist(store, holonId, checklist);
  }
  return checklist;
}

/** Toggle the checked state of a single item by index. */
export async function toggleItem(
  store: ChecklistStore,
  holonId: string | number,
  checklistId: string,
  itemIndex: number
): Promise<Checklist | null> {
  const checklist = await getChecklist(store, holonId, checklistId);
  if (!checklist || !checklist.items[itemIndex]) return null;
  checklist.items[itemIndex].checked = !checklist.items[itemIndex].checked;
  await putChecklist(store, holonId, checklist);
  return checklist;
}

/** Remove an item by index. */
export async function removeItemAt(
  store: ChecklistStore,
  holonId: string | number,
  checklistId: string,
  itemIndex: number
): Promise<{ checklist: Checklist; removed: ChecklistItem } | null> {
  const checklist = await getChecklist(store, holonId, checklistId);
  if (!checklist || !checklist.items[itemIndex]) return null;
  const [removed] = checklist.items.splice(itemIndex, 1);
  await putChecklist(store, holonId, checklist);
  return { checklist, removed };
}

/** Remove the first item whose text matches exactly. */
export async function removeItemByText(
  store: ChecklistStore,
  holonId: string | number,
  checklistId: string,
  text: string
): Promise<
  | { ok: true; checklist: Checklist }
  | { ok: false; reason: 'not_found' | 'item_missing' }
> {
  const checklist = await getChecklist(store, holonId, checklistId);
  if (!checklist) return { ok: false, reason: 'not_found' };
  const before = checklist.items.length;
  checklist.items = checklist.items.filter((i) => i.text !== text);
  if (checklist.items.length === before) {
    return { ok: false, reason: 'item_missing' };
  }
  await putChecklist(store, holonId, checklist);
  return { ok: true, checklist };
}

/** Drop all checked items. Returns the removed items. */
export async function deleteCheckedItems(
  store: ChecklistStore,
  holonId: string | number,
  checklistId: string
): Promise<
  | { ok: true; checklist: Checklist; removed: ChecklistItem[] }
  | { ok: false; reason: 'not_found' | 'none_checked' }
> {
  const checklist = await getChecklist(store, holonId, checklistId);
  if (!checklist) return { ok: false, reason: 'not_found' };
  const removed = checklist.items.filter((i) => i.checked);
  if (removed.length === 0) return { ok: false, reason: 'none_checked' };
  checklist.items = checklist.items.filter((i) => !i.checked);
  await putChecklist(store, holonId, checklist);
  return { ok: true, checklist, removed };
}

/**
 * Clear-completion behavior used by the "🔄 Clear All" / "🗑️ Clear Completed"
 * buttons. For agenda lists this removes checked items; for everything else
 * it un-checks every item.
 */
export async function clearChecklist(
  store: ChecklistStore,
  holonId: string | number,
  checklistId: string
): Promise<
  | { ok: true; checklist: Checklist; mode: 'removed_checked'; count: number }
  | { ok: true; checklist: Checklist; mode: 'unchecked_all' }
  | { ok: false; reason: 'not_found' | 'nothing_to_remove' }
> {
  const checklist = await getChecklist(store, holonId, checklistId);
  if (!checklist) return { ok: false, reason: 'not_found' };

  if (checklist.type === CHECKLIST_TYPES.AGENDA) {
    const checkedCount = checklist.items.filter((i) => i.checked).length;
    if (checkedCount === 0) return { ok: false, reason: 'nothing_to_remove' };
    checklist.items = checklist.items.filter((i) => !i.checked);
    await putChecklist(store, holonId, checklist);
    return {
      ok: true,
      checklist,
      mode: 'removed_checked',
      count: checkedCount,
    };
  }

  checklist.items = checklist.items.map((i) => ({ ...i, checked: false }));
  await putChecklist(store, holonId, checklist);
  return { ok: true, checklist, mode: 'unchecked_all' };
}
