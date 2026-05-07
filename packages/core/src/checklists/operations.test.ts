import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_TYPES,
  appendItems,
  clearChecklist,
  createChecklist,
  createChecklistObject,
  deleteChecklist,
  deleteCheckedItems,
  getAllChecklists,
  getChecklist,
  getChecklistDisplayTitle,
  getChecklistIcon,
  getTypeDisplayName,
  isSpecialChecklist,
  migrateLegacyChecklistType,
  parseItemsText,
  removeItemAt,
  removeItemByText,
  toggleItem,
} from './index.js';
import type { Checklist, ChecklistStore } from './index.js';

/** In-memory ChecklistStore matching the Holosphere DB shape. */
function memStore(): ChecklistStore & {
  data: Map<string, Map<string, Map<string, any>>>;
} {
  const data = new Map<string, Map<string, Map<string, any>>>();
  const bucket = (h: string, b: string) => {
    if (!data.has(h)) data.set(h, new Map());
    const holon = data.get(h)!;
    if (!holon.has(b)) holon.set(b, new Map());
    return holon.get(b)!;
  };
  return {
    data,
    async get(h, b, k) {
      return bucket(h, b).get(k) ?? null;
    },
    async getAll(h, b) {
      return Array.from(bucket(h, b).values());
    },
    async put(h, b, value: any) {
      bucket(h, b).set(value.id, value);
    },
    async delete(h, b, k) {
      bucket(h, b).delete(k);
    },
  };
}

describe('checklists/helpers', () => {
  it('createChecklistObject sets type-specific fields', () => {
    const cl = createChecklistObject('q1', CHECKLIST_TYPES.QUEST, {
      questId: 'q1',
      parentTitle: 'My Quest',
      holonId: 'h',
      creator: 'u1',
    });
    expect(cl).toMatchObject({
      id: 'q1',
      type: 'quest',
      questId: 'q1',
      parentTitle: 'My Quest',
      holonId: 'h',
      creator: 'u1',
      items: [],
    });
  });

  it('migrateLegacyChecklistType infers from properties', () => {
    expect(migrateLegacyChecklistType({ id: 'agenda', items: [] }).type).toBe(
      'agenda'
    );
    expect(
      migrateLegacyChecklistType({ id: 'x', items: [], questId: 'q' }).type
    ).toBe('quest');
    expect(
      migrateLegacyChecklistType({ id: 'x', items: [], roleId: 'r' }).type
    ).toBe('role');
    expect(migrateLegacyChecklistType({ id: 'x', items: [] }).type).toBe(
      'checklist'
    );
  });

  it('isSpecialChecklist works for ids and records', () => {
    expect(isSpecialChecklist('agenda')).toBe(true);
    expect(isSpecialChecklist('shopping')).toBe(true);
    expect(isSpecialChecklist('x')).toBe(false);
    expect(
      isSpecialChecklist({ id: 'x', items: [], type: CHECKLIST_TYPES.AGENDA })
    ).toBe(true);
  });

  it('display + icon helpers', () => {
    expect(getChecklistDisplayTitle({ id: 'foo', items: [] } as Checklist)).toBe(
      'FOO'
    );
    expect(
      getChecklistDisplayTitle({
        id: 'x',
        items: [],
        parentTitle: 'Parent',
      } as Checklist)
    ).toBe('Parent');
    expect(getChecklistIcon('agenda')).toBe('📅');
    expect(getChecklistIcon('shopping')).toBe('🛒');
    expect(getChecklistIcon({ id: 'x', items: [], type: 'role' })).toBe('👥');
    expect(getTypeDisplayName('quest')).toBe('task');
    expect(getTypeDisplayName('shopping')).toBe('shopping list');
  });

  it('parseItemsText drops blanks', () => {
    expect(parseItemsText('a, , b , ,c')).toEqual([
      { text: 'a', checked: false },
      { text: 'b', checked: false },
      { text: 'c', checked: false },
    ]);
    expect(parseItemsText('')).toEqual([]);
  });
});

describe('checklists/CRUD', () => {
  it('createChecklist rejects underscores and dupes', async () => {
    const store = memStore();
    expect((await createChecklist(store, 'h', 'bad_name')).ok).toBe(false);
    const ok = await createChecklist(store, 'h', 'morning');
    expect(ok.ok).toBe(true);
    const dupe = await createChecklist(store, 'h', 'morning');
    expect(dupe.ok).toBe(false);
    if (!dupe.ok) expect(dupe.reason).toBe('exists');
  });

  it('getChecklist migrates legacy records on read', async () => {
    const store = memStore();
    await store.put('h', 'checklists', {
      id: 'q1',
      items: [],
      questId: 'q1',
    });
    const cl = await getChecklist(store, 'h', 'q1');
    expect(cl?.type).toBe('quest');
  });

  it('appendItems creates the checklist if missing', async () => {
    const store = memStore();
    const cl = await appendItems(
      store,
      'h',
      'fresh',
      [{ text: 'one', checked: false }],
      { type: CHECKLIST_TYPES.CHECKLIST }
    );
    expect(cl.items).toHaveLength(1);
    const reloaded = await getChecklist(store, 'h', 'fresh');
    expect(reloaded?.items[0].text).toBe('one');
  });

  it('toggleItem flips checked', async () => {
    const store = memStore();
    await createChecklist(store, 'h', 'a');
    await appendItems(store, 'h', 'a', [{ text: 'x', checked: false }]);
    const after = await toggleItem(store, 'h', 'a', 0);
    expect(after?.items[0].checked).toBe(true);
    const back = await toggleItem(store, 'h', 'a', 0);
    expect(back?.items[0].checked).toBe(false);
    expect(await toggleItem(store, 'h', 'a', 99)).toBeNull();
  });

  it('removeItemAt + removeItemByText', async () => {
    const store = memStore();
    await createChecklist(store, 'h', 'a');
    await appendItems(store, 'h', 'a', [
      { text: 'x', checked: false },
      { text: 'y', checked: false },
      { text: 'z', checked: false },
    ]);
    const r1 = await removeItemAt(store, 'h', 'a', 1);
    expect(r1?.removed.text).toBe('y');
    expect(r1?.checklist.items.map((i) => i.text)).toEqual(['x', 'z']);

    const r2 = await removeItemByText(store, 'h', 'a', 'z');
    expect(r2.ok).toBe(true);
    const r3 = await removeItemByText(store, 'h', 'a', 'nope');
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.reason).toBe('item_missing');
  });

  it('deleteCheckedItems', async () => {
    const store = memStore();
    await createChecklist(store, 'h', 'a');
    await appendItems(store, 'h', 'a', [
      { text: 'x', checked: true },
      { text: 'y', checked: false },
      { text: 'z', checked: true },
    ]);
    const result = await deleteCheckedItems(store, 'h', 'a');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.removed).toHaveLength(2);
      expect(result.checklist.items).toHaveLength(1);
    }
    const empty = await deleteCheckedItems(store, 'h', 'a');
    expect(empty.ok).toBe(false);
  });

  it('clearChecklist behavior differs by type', async () => {
    const store = memStore();
    // Regular -> uncheck all
    await createChecklist(store, 'h', 'a');
    await appendItems(store, 'h', 'a', [
      { text: 'x', checked: true },
      { text: 'y', checked: true },
    ]);
    const r1 = await clearChecklist(store, 'h', 'a');
    expect(r1.ok && r1.mode === 'unchecked_all').toBe(true);
    if (r1.ok && r1.mode === 'unchecked_all') {
      expect(r1.checklist.items.every((i) => !i.checked)).toBe(true);
    }

    // Agenda -> remove checked
    await createChecklist(store, 'h', 'agenda', {
      type: CHECKLIST_TYPES.AGENDA,
    });
    await appendItems(store, 'h', 'agenda', [
      { text: 'a', checked: true },
      { text: 'b', checked: false },
    ]);
    const r2 = await clearChecklist(store, 'h', 'agenda');
    expect(r2.ok && r2.mode === 'removed_checked').toBe(true);
    if (r2.ok && r2.mode === 'removed_checked') {
      expect(r2.count).toBe(1);
      expect(r2.checklist.items).toHaveLength(1);
    }
  });

  it('deleteChecklist refuses special checklists', async () => {
    const store = memStore();
    await store.put('h', 'checklists', {
      id: 'agenda',
      type: 'agenda',
      items: [],
    });
    const r = await deleteChecklist(store, 'h', 'agenda');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('special');
    expect(await getChecklist(store, 'h', 'agenda')).not.toBeNull();
  });

  it('getAllChecklists migrates every record', async () => {
    const store = memStore();
    await store.put('h', 'checklists', { id: 'agenda', items: [] });
    await store.put('h', 'checklists', { id: 'x', items: [], roleId: 'r' });
    const all = await getAllChecklists(store, 'h');
    const types = all.map((c) => c.type).sort();
    expect(types).toEqual(['agenda', 'role']);
  });
});
