import { describe, expect, it, vi } from 'vitest';
import {
  addItem,
  bookItem,
  borrowItem,
  cancelBooking,
  computeBorrowerInitials,
  createLibraryItem,
  detectItemType,
  filterItems,
  getItem,
  getItemDisplayTitle,
  getItemIcon,
  getLibraryStats,
  getTypeDisplayName,
  listItems,
  removeItem,
  returnItem,
  setItemValue,
  updateBookingDates
} from './operations.js';
import { getDisplayBookings, ymd } from './bookings.js';
import { LIBRARY_TYPES, type LibraryDB, type LibraryItem } from './types.js';

function mockDb(initial: Record<string, LibraryItem> = {}): {
  db: LibraryDB;
  store: Map<string, LibraryItem>;
  put: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
} {
  const store = new Map(Object.entries(initial));
  const put = vi.fn(async (_h: string, _l: string, data: any) => {
    store.set(data.id, data);
  });
  const del = vi.fn(async (_h: string, _l: string, key: string) => {
    store.delete(key);
  });
  const db: LibraryDB = {
    get: vi.fn(async (_h: string, _l: string, key?: string) => store.get(key ?? '') ?? null),
    put,
    delete: del,
    getAll: vi.fn(async () => Array.from(store.values()))
  };
  return { db, store, put, del };
}

describe('detectItemType', () => {
  it('detects tools, books, equipment, accommodation, and falls back to other', () => {
    expect(detectItemType('hammer')).toBe(LIBRARY_TYPES.TOOL);
    expect(detectItemType('A guide to bees')).toBe(LIBRARY_TYPES.BOOK);
    expect(detectItemType('Camera tripod')).toBe(LIBRARY_TYPES.EQUIPMENT);
    expect(detectItemType('Guest room upstairs')).toBe(LIBRARY_TYPES.ACCOMMODATION);
    expect(detectItemType('thingamajig')).toBe(LIBRARY_TYPES.OTHER);
  });
});

describe('createLibraryItem', () => {
  it('uses sensible defaults and preserves overrides', () => {
    const item = createLibraryItem('drill', LIBRARY_TYPES.TOOL, {
      createdBy: 1,
      createdByUsername: 'alice',
      category: 'shed',
      value: 5
    });
    expect(item).toMatchObject({
      id: 'drill',
      type: 'tool',
      borrowed: false,
      borrower: null,
      category: 'shed',
      value: 5,
      createdBy: 1,
      createdByUsername: 'alice'
    });
    // Canonical creation timestamp is an ISO string everywhere.
    expect(typeof item.created).toBe('string');
    expect(Number.isFinite(Date.parse(item.created))).toBe(true);
  });

  it('falls back to OTHER when type is missing', () => {
    expect(createLibraryItem('x').type).toBe(LIBRARY_TYPES.OTHER);
  });
});

describe('getItemIcon / getTypeDisplayName / getItemDisplayTitle', () => {
  it('maps types to icons', () => {
    expect(getItemIcon({ type: LIBRARY_TYPES.TOOL })).toBe('🔧');
    expect(getItemIcon({ type: LIBRARY_TYPES.BOOK })).toBe('📚');
    expect(getItemIcon({ type: LIBRARY_TYPES.EQUIPMENT })).toBe('⚙️');
    expect(getItemIcon({ type: LIBRARY_TYPES.ACCOMMODATION })).toBe('🛏️');
    expect(getItemIcon({ type: LIBRARY_TYPES.OTHER })).toBe('📦');
    expect(getItemIcon('legacy-string')).toBe('📦');
  });
  it('maps types to display names', () => {
    expect(getTypeDisplayName(LIBRARY_TYPES.TOOL)).toBe('tool');
    expect(getTypeDisplayName(LIBRARY_TYPES.ACCOMMODATION)).toBe('accommodation');
    expect(getTypeDisplayName(undefined)).toBe('item');
  });
  it('shows custom categories as themselves instead of "item"', () => {
    expect(getTypeDisplayName('kitchen')).toBe('kitchen');
    expect(getTypeDisplayName('  kitchen  ')).toBe('kitchen');
    expect(getTypeDisplayName('')).toBe('item');
    expect(getTypeDisplayName('   ')).toBe('item');
  });
  it('handles legacy string items', () => {
    expect(getItemDisplayTitle('plain')).toBe('plain');
    expect(getItemDisplayTitle({ id: 'drill' })).toBe('drill');
  });
});

describe('computeBorrowerInitials', () => {
  it('prefers first+last initials, then username, then ?', () => {
    expect(computeBorrowerInitials({ id: 1, first_name: 'Ada', last_name: 'Lovelace' })).toBe('AL');
    expect(computeBorrowerInitials({ id: 2, first_name: 'Mononym' })).toBe('M');
    expect(computeBorrowerInitials({ id: 3, username: 'zara' })).toBe('Z');
    expect(computeBorrowerInitials({ id: 4 })).toBe('?');
  });
});

describe('addItem', () => {
  it('adds when absent and rejects duplicates', async () => {
    const { db, store, put } = mockDb();
    const ok = await addItem(db, 'h1', 'hammer', { createdBy: 1, value: 3 });
    expect(ok.ok).toBe(true);
    expect(ok.item?.type).toBe(LIBRARY_TYPES.TOOL);
    expect(store.has('hammer')).toBe(true);
    expect(put).toHaveBeenCalledTimes(1);

    const dup = await addItem(db, 'h1', 'hammer');
    expect(dup.ok).toBe(false);
    expect(dup.reason).toBe('already_exists');
  });

  it('honors an explicit type over the name-keyword guess', async () => {
    const { db } = mockDb();
    // "hammer" would auto-detect as a tool; the caller overrides to book.
    const res = await addItem(db, 'h1', 'hammer', { type: LIBRARY_TYPES.BOOK });
    expect(res.ok).toBe(true);
    expect(res.item?.type).toBe(LIBRARY_TYPES.BOOK);
  });
});

describe('removeItem / getItem / listItems / filterItems / getLibraryStats', () => {
  it('round-trips through the storage layer', async () => {
    const { db, del } = mockDb({
      apple: createLibraryItem('apple', LIBRARY_TYPES.OTHER, { category: 'fruit' }),
      drill: createLibraryItem('drill', LIBRARY_TYPES.TOOL, { category: 'shed' })
    });
    expect((await getItem(db, 'h', 'apple'))?.id).toBe('apple');
    const items = await listItems(db, 'h');
    expect(items.map((i) => i.id)).toEqual(['apple', 'drill']);

    expect(filterItems(items, 'shed').map((i) => i.id)).toEqual(['drill']);
    expect(filterItems(items, '').length).toBe(2);

    const stats = getLibraryStats(items);
    expect(stats.total).toBe(2);
    expect(stats.borrowed).toBe(0);
    expect(stats.available).toBe(2);
    expect(stats.byType).toEqual({ other: 1, tool: 1 });

    await removeItem(db, 'h', 'apple');
    expect(del).toHaveBeenCalledWith('h', 'library', 'apple');
  });
});

describe('setItemValue', () => {
  it('lets the owner change value and rejects others', async () => {
    const item = createLibraryItem('drill', LIBRARY_TYPES.TOOL, { createdBy: 1, value: 5 });
    const { db } = mockDb({ drill: item });

    const owner = await setItemValue(db, 'h', 'drill', 8, 1);
    expect(owner.ok).toBe(true);
    expect(owner.item?.value).toBe(8);

    const stranger = await setItemValue(db, 'h', 'drill', 999, 2);
    expect(stranger.ok).toBe(false);
    expect(stranger.reason).toBe('forbidden');

    const missing = await setItemValue(db, 'h', 'nope', 1, 1);
    expect(missing.ok).toBe(false);
    expect(missing.reason).toBe('not_found');
  });
});

describe('borrowItem / returnItem', () => {
  it('marks borrowed/returned and surfaces ownership', async () => {
    const item = createLibraryItem('drill', LIBRARY_TYPES.TOOL, { createdBy: 10, value: 2 });
    const { db } = mockDb({ drill: item });

    const taken = await borrowItem(
      db,
      'h',
      'drill',
      { id: 20, username: 'bob', first_name: 'Bob' },
      new Date('2099-01-01')
    );
    expect(taken.ok).toBe(true);
    expect(taken.isOwner).toBe(false);
    expect(taken.item?.borrowed).toBe(true);
    expect(taken.item?.borrowerInitials).toBe('B');

    const conflict = await borrowItem(
      db,
      'h',
      'drill',
      { id: 30, username: 'eve' },
      new Date('2099-02-01')
    );
    expect(conflict.ok).toBe(false);
    expect(conflict.reason).toBe('already_borrowed');

    const wrongReturner = await returnItem(db, 'h', 'drill', { id: 99, username: 'mallory' });
    expect(wrongReturner.ok).toBe(false);
    expect(wrongReturner.reason).toBe('forbidden');
    // Snapshot is preserved on forbidden so callers can show the borrower.
    expect(wrongReturner.item?.borrower).toBe('bob');

    const returned = await returnItem(db, 'h', 'drill', { id: 20, username: 'bob' });
    expect(returned.ok).toBe(true);
    expect(returned.item?.borrowed).toBe(false);
    // value/createdBy survive the return so accounting helpers still work.
    expect(returned.item?.value).toBe(2);
    expect(returned.item?.createdBy).toBe(10);

    const notBorrowed = await returnItem(db, 'h', 'drill', { id: 20, username: 'bob' });
    expect(notBorrowed.ok).toBe(false);
    expect(notBorrowed.reason).toBe('not_borrowed');
  });

  it('rejects borrow on missing item', async () => {
    const { db } = mockDb();
    const r = await borrowItem(db, 'h', 'missing', { id: 1 }, new Date());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not_found');
  });

  it('writes a booking, tolerates @-prefixed / renamed returners, and keeps future reservations', async () => {
    const item = createLibraryItem('drill', LIBRARY_TYPES.TOOL, { createdBy: 10 });
    const { db } = mockDb({ drill: item });

    const taken = await borrowItem(db, 'h', 'drill', { id: 20, username: 'bob' }, '2099-01-01');
    expect(taken.item?.bookings).toHaveLength(1);
    expect(taken.item?.bookings?.[0]).toMatchObject({
      start: ymd(new Date()),
      end: '2099-01-01',
      borrowerId: '20',
      borrower: 'bob'
    });

    // A reservation after the borrow window is allowed and doesn't flip the mirror.
    const reserved = await bookItem(
      db,
      'h',
      'drill',
      { id: 30, username: 'eve' },
      { start: '2099-02-01', end: '2099-02-05' }
    );
    expect(reserved.ok).toBe(true);
    expect(reserved.item?.bookings).toHaveLength(2);
    expect(reserved.item?.borrower).toBe('bob'); // mirror still shows today's borrower

    // Return by the same person under a web-style '@' handle succeeds and
    // leaves eve's future reservation in place.
    const returned = await returnItem(db, 'h', 'drill', { id: 999, username: '@Bob' });
    expect(returned.ok).toBe(true);
    expect(returned.item?.borrowed).toBe(false);
    expect(returned.item?.bookings).toHaveLength(1);
    expect(returned.item?.bookings?.[0].borrower).toBe('eve');
  });

  it('blocks a borrow that collides with a future reservation (reason overlaps)', async () => {
    const item = createLibraryItem('drill', LIBRARY_TYPES.TOOL, { createdBy: 10 });
    const { db } = mockDb({ drill: item });

    const reserved = await bookItem(
      db,
      'h',
      'drill',
      { id: 30, username: 'eve' },
      { start: '2099-02-01', end: '2099-02-05' }
    );
    expect(reserved.ok).toBe(true);

    const clash = await borrowItem(db, 'h', 'drill', { id: 20, username: 'bob' }, '2099-03-01');
    expect(clash.ok).toBe(false);
    expect(clash.reason).toBe('overlaps');
    expect(clash.conflict?.borrower).toBe('eve');
  });

  it('migrates a legacy single-borrow into the bookings array on return', async () => {
    const legacy = {
      ...createLibraryItem('drill', LIBRARY_TYPES.TOOL, { createdBy: 10 }),
      borrowed: true,
      borrower: 'bob',
      borrowerId: 20,
      borrowedAt: new Date().toISOString(),
      returnBy: '2099-01-01'
    };
    const { db } = mockDb({ drill: legacy });

    const blocked = await bookItem(db, 'h', 'drill', { id: 30 }, { end: '2099-01-01' });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('overlaps');

    const returned = await returnItem(db, 'h', 'drill', { id: 20, username: 'bob' });
    expect(returned.ok).toBe(true);
    expect(returned.item?.bookings).toEqual([]);
    expect(returned.item?.borrowed).toBe(false);
  });
});

describe('bookItem validation', () => {
  it('rejects inverted ranges and missing items', async () => {
    const item = createLibraryItem('drill', LIBRARY_TYPES.TOOL, {});
    const { db } = mockDb({ drill: item });
    const bad = await bookItem(
      db,
      'h',
      'drill',
      { id: 1 },
      { start: '2099-02-05', end: '2099-02-01' }
    );
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe('invalid_range');

    const missing = await bookItem(db, 'h', 'nope', { id: 1 }, { end: '2099-02-01' });
    expect(missing.reason).toBe('not_found');
  });
});

describe('cancelBooking / updateBookingDates', () => {
  async function seed() {
    const item = createLibraryItem('drill', LIBRARY_TYPES.TOOL, { createdBy: 10 });
    const { db } = mockDb({ drill: item });
    const r = await bookItem(
      db,
      'h',
      'drill',
      { id: 30, username: 'eve' },
      { start: '2099-02-01', end: '2099-02-05' }
    );
    return { db, bookingId: r.booking!.id };
  }

  it('only the booking borrower may cancel; cancel removes the booking', async () => {
    const { db, bookingId } = await seed();

    const stranger = await cancelBooking(db, 'h', 'drill', bookingId, { id: 99 });
    expect(stranger.ok).toBe(false);
    expect(stranger.reason).toBe('forbidden');

    const gone = await cancelBooking(db, 'h', 'drill', bookingId, { id: 30 });
    expect(gone.ok).toBe(true);
    expect(getDisplayBookings(gone.item!)).toHaveLength(0);

    const again = await cancelBooking(db, 'h', 'drill', bookingId, { id: 30 });
    expect(again.reason).toBe('no_such_booking');
  });

  it('reschedules with overlap checking against other bookings only', async () => {
    const { db, bookingId } = await seed();
    await bookItem(db, 'h', 'drill', { id: 20, username: 'bob' }, {
      start: '2099-03-01',
      end: '2099-03-05'
    });

    // Sliding within its own old range is fine (self excluded from the check).
    const slid = await updateBookingDates(
      db,
      'h',
      'drill',
      bookingId,
      { start: '2099-02-03', end: '2099-02-10' },
      { id: 30 }
    );
    expect(slid.ok).toBe(true);
    expect(slid.booking).toMatchObject({ start: '2099-02-03', end: '2099-02-10' });

    const clash = await updateBookingDates(
      db,
      'h',
      'drill',
      bookingId,
      { start: '2099-02-03', end: '2099-03-02' },
      { id: 30 }
    );
    expect(clash.ok).toBe(false);
    expect(clash.reason).toBe('overlaps');
    expect(clash.conflict?.borrower).toBe('bob');

    const stranger = await updateBookingDates(
      db,
      'h',
      'drill',
      bookingId,
      { start: '2099-02-03', end: '2099-02-04' },
      { id: 99 }
    );
    expect(stranger.reason).toBe('forbidden');
  });
});
