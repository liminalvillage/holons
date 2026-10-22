import { describe, expect, it, vi } from 'vitest';
import { recordBorrowAccounting, recordReturnAccounting } from './deposits.js';
import { createLibraryItem } from './operations.js';
import { LIBRARY_TYPES, type LibraryDB } from './types.js';

function harness() {
  const dbPut = vi.fn<(holon: string, lens: string, data: unknown) => Promise<void>>(
    async () => undefined
  );
  const db: LibraryDB = {
    get: vi.fn(async () => null),
    put: dbPut,
    delete: vi.fn(async () => undefined),
    getAll: vi.fn(async () => [])
  };
  // Legacy plumbing some callers still pass: the ledger projection owns the
  // REA side now, so these must never be invoked.
  const eventStorePut = vi.fn(async () => undefined);
  const eventStore = { put: eventStorePut };
  const factory = {
    itemBorrowed: vi.fn(() => [{ id: 'b1' }, { id: 'b2' }]),
    itemReturned: vi.fn(() => [{ id: 'r1' }])
  };
  return { deps: { db, eventStore, eventFactory: factory }, dbPut, eventStorePut, factory };
}

describe('recordBorrowAccounting', () => {
  it('skips when borrower is the owner', async () => {
    const { deps, dbPut, eventStorePut } = harness();
    const item = createLibraryItem('drill', LIBRARY_TYPES.TOOL, { createdBy: 1, value: 5 });
    await recordBorrowAccounting(deps, 'h', { id: 1 }, item);
    expect(dbPut).not.toHaveBeenCalled();
    expect(eventStorePut).not.toHaveBeenCalled();
  });

  it('skips when item has no value', async () => {
    const { deps, dbPut } = harness();
    const item = createLibraryItem('drill', LIBRARY_TYPES.TOOL, { createdBy: 1, value: 0 });
    await recordBorrowAccounting(deps, 'h', { id: 2 }, item);
    expect(dbPut).not.toHaveBeenCalled();
  });

  it('writes the credit expense for a billable borrow, and no REA events itself', async () => {
    const { deps, dbPut, eventStorePut, factory } = harness();
    const item = createLibraryItem('drill', LIBRARY_TYPES.TOOL, { createdBy: 1, value: 5 });
    await recordBorrowAccounting(deps, 'h', { id: 2, username: 'b' }, item);
    expect(dbPut).toHaveBeenCalledTimes(1);
    expect(dbPut.mock.calls[0][1]).toBe('expenses');
    expect(dbPut.mock.calls[0][2]).toMatchObject({ type: 'borrow', itemId: 'drill', currency: 'credits', amount: 5 });
    expect(eventStorePut).not.toHaveBeenCalled();
    expect(factory.itemBorrowed).not.toHaveBeenCalled();
  });

  it('works without any event plumbing at all (kiosk, web)', async () => {
    const { deps, dbPut } = harness();
    const item = createLibraryItem('drill', LIBRARY_TYPES.TOOL, { createdBy: 1, value: 5 });
    await recordBorrowAccounting({ db: deps.db }, 'h', { id: 2 }, item);
    expect(dbPut).toHaveBeenCalledTimes(1);
  });
});

describe('recordReturnAccounting', () => {
  it('writes the refund expense for a non-owner, and no REA events itself', async () => {
    const { deps, dbPut, eventStorePut, factory } = harness();
    const item = createLibraryItem('drill', LIBRARY_TYPES.TOOL, { createdBy: 1, value: 5 });
    await recordReturnAccounting(deps, 'h', { id: 2 }, item);
    expect(dbPut).toHaveBeenCalledTimes(1);
    expect(dbPut.mock.calls[0][2]).toMatchObject({ type: 'return', itemId: 'drill' });
    expect(eventStorePut).not.toHaveBeenCalled();
    expect(factory.itemReturned).not.toHaveBeenCalled();
  });

  it('skips the refund expense when the owner returns', async () => {
    const { deps, dbPut, eventStorePut } = harness();
    const item = createLibraryItem('drill', LIBRARY_TYPES.TOOL, { createdBy: 1, value: 5 });
    await recordReturnAccounting(deps, 'h', { id: 1 }, item);
    expect(dbPut).not.toHaveBeenCalled();
    expect(eventStorePut).not.toHaveBeenCalled();
  });
});
