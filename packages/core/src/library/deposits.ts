/**
 * @holons/core/library — borrow/return accounting (expenses + REA events).
 *
 * Pure side-effects on the storage + event-store provided by the caller. The
 * REA event factory and aggregator live in `packages/telegram-ui/src/domain/rea`
 * for now; this module accepts them via parameters so future units (e.g. a
 * web borrow flow) can reuse the same accounting glue.
 */

import type { BorrowActor, LibraryDB, LibraryItem } from './types.js';

// Local declaration: the core tsconfig targets ES2022 without DOM/Node libs,
// so `console` isn't in the type lib. Accounting failures are non-fatal and
// logged best-effort at runtime; this declare keeps the host's console.
declare const console: { error: (...args: unknown[]) => void };

const EXPENSES_LENS = 'expenses';

/** Minimal interface a REA event store needs to satisfy. */
export interface REAEventStoreLike {
  put(holonId: string | number, event: any): Promise<unknown>;
}

/** Minimal interface a REA event factory needs to satisfy. */
export interface REAEventFactoryLike {
  itemBorrowed(
    holonId: string | number,
    borrower: BorrowActor,
    item: LibraryItem,
    credits: number,
    deposit: number
  ): any[];
  itemReturned(
    holonId: string | number,
    borrower: BorrowActor,
    item: LibraryItem,
    depositAmount: number
  ): any[];
}

export interface AccountingDeps {
  db: LibraryDB;
  /**
   * REA event plumbing is optional: surfaces without an event store (web,
   * kiosk) still record the credit expenses; only the bot emits REA events.
   */
  eventStore?: REAEventStoreLike;
  eventFactory?: REAEventFactoryLike;
}

/**
 * Record the bookkeeping for an item-borrow: a credit-denominated expense
 * shared between owner and borrower, plus the matching REA events. Skipped
 * silently when the borrower owns the item, or when the item has no value.
 *
 * Errors are swallowed (logged) so a bookkeeping hiccup never blocks the
 * underlying borrow — matches the behaviour of the original Library.js.
 */
export async function recordBorrowAccounting(
  deps: AccountingDeps,
  holonId: string | number,
  borrower: BorrowActor,
  item: LibraryItem
): Promise<void> {
  if (item.createdBy === borrower.id) return;
  if (!item.value || item.value <= 0) return;

  const holon = String(holonId);
  try {
    const expense = {
      id: Date.now(),
      date: Date.now(),
      amount: item.value,
      currency: 'credits',
      description: `Borrowed: ${item.id}`,
      paidBy: item.createdBy,
      splitWith: [borrower.id],
      itemId: item.id,
      type: 'borrow' as const
    };
    await deps.db.put(holon, EXPENSES_LENS, expense);

    if (deps.eventFactory && deps.eventStore) {
      const store = deps.eventStore;
      const events = deps.eventFactory.itemBorrowed(holonId, borrower, item, item.value, 0);
      await Promise.all(events.map((e) => store.put(holonId, e)));
    }
  } catch (error) {
    console.error('Error creating borrow expense/events:', error);
  }
}

/**
 * Record the bookkeeping for an item-return: a refund expense (reverse of the
 * borrow charge) and the matching REA events. Skipped when the returner owns
 * the item or when there is nothing to refund.
 */
export async function recordReturnAccounting(
  deps: AccountingDeps,
  holonId: string | number,
  returner: BorrowActor,
  item: LibraryItem
): Promise<void> {
  const holon = String(holonId);
  const isOwner = item.createdBy === returner.id;
  const value = item.value || 0;

  if (!isOwner && value > 0) {
    try {
      const refundExpense = {
        id: Date.now(),
        date: Date.now(),
        amount: value,
        currency: 'credits',
        description: `Returned: ${item.id}`,
        paidBy: returner.id,
        splitWith: [item.createdBy],
        itemId: item.id,
        type: 'return' as const
      };
      await deps.db.put(holon, EXPENSES_LENS, refundExpense);
    } catch (error) {
      console.error('Error creating return expense:', error);
    }
  }

  if (deps.eventFactory && deps.eventStore) {
    const store = deps.eventStore;
    try {
      const events = deps.eventFactory.itemReturned(holonId, returner, item, value);
      await Promise.all(events.map((e) => store.put(holonId, e)));
    } catch (error) {
      console.error('Error creating REA events for return:', error);
    }
  }
}
