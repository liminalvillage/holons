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

  it('writes expense + REA events for a billable borrow', async () => {
    const { deps, dbPut, eventStorePut, factory } = harness();
    const item = createLibraryItem('drill', LIBRARY_TYPES.TOOL, { createdBy: 1, value: 5 });
    await recordBorrowAccounting(deps, 'h', { id: 2, username: 'b' }, item);
    expect(dbPut).toHaveBeenCalledTimes(1);
    expect(dbPut.mock.calls[0][1]).toBe('expenses');
    expect(eventStorePut).toHaveBeenCalledTimes(2);
    expect(factory.itemBorrowed).toHaveBeenCalledWith('h', { id: 2, username: 'b' }, item, 5, 0);
  });
});

describe('recordReturnAccounting', () => {
  it('writes refund expense + return REA events for non-owner', async () => {
    const { deps, dbPut, eventStorePut, factory } = harness();
    const item = createLibraryItem('drill', LIBRARY_TYPES.TOOL, { createdBy: 1, value: 5 });
    await recordReturnAccounting(deps, 'h', { id: 2 }, item);
    expect(dbPut).toHaveBeenCalledTimes(1);
    expect(eventStorePut).toHaveBeenCalledTimes(1);
    expect(factory.itemReturned).toHaveBeenCalledWith('h', { id: 2 }, item, 5);
  });

  it('skips refund expense when owner returns, but still records REA events', async () => {
    const { deps, dbPut, eventStorePut } = harness();
    const item = createLibraryItem('drill', LIBRARY_TYPES.TOOL, { createdBy: 1, value: 5 });
    await recordReturnAccounting(deps, 'h', { id: 1 }, item);
    expect(dbPut).not.toHaveBeenCalled();
    expect(eventStorePut).toHaveBeenCalledTimes(1);
  });
});
