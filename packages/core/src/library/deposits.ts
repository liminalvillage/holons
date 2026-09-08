/**
 * @holons/core/library — borrow/return accounting (the credit expenses).
 *
 * Pure side-effects on the storage provided by the caller. The ValueFlows
 * side of a borrow — `item:borrowed`, `item:fee_paid`, `item:returned` — is
 * NOT written here: the ledger projection (`@holons/core/rea`, attached to
 * every HoloSphere the core factory builds) derives those from the item's
 * `bookings[]` the moment the library lens is written, in every UI alike.
 * This module only mirrors the charge into the expenses lens, which the
 * balances views read.
 */

import type { BorrowActor, LibraryDB, LibraryItem } from './types.js';

// Local declaration: the core tsconfig targets ES2022 without DOM/Node libs,
// so `console` isn't in the type lib. Accounting failures are non-fatal and
// logged best-effort at runtime; this declare keeps the host's console.
declare const console: { error: (...args: unknown[]) => void };

const EXPENSES_LENS = 'expenses';

/** @deprecated The ledger projection records REA events; kept so old callers type-check. */
export interface REAEventStoreLike {
  put(holonId: string | number, event: any): Promise<unknown>;
}

/** @deprecated The ledger projection records REA events; kept so old callers type-check. */
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
  /** @deprecated Ignored — the ledger projection derives the REA events from the library lens. */
  eventStore?: REAEventStoreLike;
  /** @deprecated Ignored — see `eventStore`. */
  eventFactory?: REAEventFactoryLike;
}

/**
 * Record the bookkeeping for an item-borrow: a credit-denominated expense
 * shared between owner and borrower. Skipped silently when the borrower owns
 * the item, or when the item has no value.
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
  } catch (error) {
    console.error('Error creating borrow expense:', error);
  }
}

/**
 * Record the bookkeeping for an item-return: a refund expense (reverse of the
 * borrow charge). Skipped when the returner owns the item or when there is
 * nothing to refund.
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
}
