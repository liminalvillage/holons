/**
 * REA Event Factory — TS port of telegram-ui's REAEventFactory.
 *
 * Static factory class producing properly structured Resource-Event-Agent
 * events: quests, appreciation, expenses, time logs, items, offers/wants,
 * credits. Output is byte-identical to the original JS factory so existing
 * stored events keep aggregating correctly.
 */

import type { REAEvent } from './event-store.js';

/** Loose user shape accepted by the factory (id required, name fields optional). */
interface UserLike {
  id: string | number;
  username?: string;
  first_name?: string;
  [key: string]: any;
}

/** Agent object produced by the factory. */
interface Agent {
  id: string;
  type: 'user' | 'holon' | 'external';
  name?: string;
}

/** Loose expense shape used by `expenseEvents`. */
interface ExpenseLike {
  id: string | number;
  amount: number;
  currency: string;
  description: string;
  paidBy: string | number;
  splitWith: Array<string | number>;
  date?: number;
  [key: string]: any;
}

/** Library item shape used by `itemBorrowed`/`itemReturned`. */
interface LibraryItemLike {
  id: string | number;
  createdBy?: string | number;
  [key: string]: any;
}

/**
 * Factory class for creating properly structured REA events.
 * All methods are static and pure (apart from `Date.now()` and the id nonce).
 */
export class REAEventFactory {
  /** Generate a unique event id: `${holonId}_${ts}_${rand}`. */
  static generateId(holonId: string | number): string {
    const timestamp = Date.now();
    const nonce = Math.random().toString(36).substring(2, 9);
    return `${holonId}_${timestamp}_${nonce}`;
  }

  /** Build a user Agent from a user-like object. */
  static createUserAgent(user: UserLike): Agent {
    return {
      id: String(user.id),
      type: 'user',
      name: user.username || user.first_name || String(user.id),
    };
  }

  /** Build a holon Agent. */
  static createHolonAgent(holonId: string | number, name: string | null = null): Agent {
    return {
      id: String(holonId),
      type: 'holon',
      name: name || String(holonId),
    };
  }

  /** Build an external Agent (used as the receiver for expense:paid). */
  static createExternalAgent(description: string): Agent {
    return {
      id: 'external',
      type: 'external',
      name: description,
    };
  }

  // ==================== Quest Events ====================

  /** Quest initiated event. */
  static questInitiated(
    holonId: string | number,
    initiator: UserLike,
    quest: { id: string | number; title: string },
  ): REAEvent {
    return {
      id: this.generateId(holonId),
      timestamp: Date.now(),
      resource: {
        type: 'appreciation',
        quantity: 1,
        unit: 'initiative',
      },
      provider: this.createUserAgent(initiator),
      receiver: this.createHolonAgent(holonId),
      context: {
        holonId: String(holonId),
        questId: String(quest.id),
        note: quest.title,
      },
      eventType: 'quest:initiated',
      status: 'confirmed',
    };
  }

  /** Quest completed event. */
  static questCompleted(
    holonId: string | number,
    participant: UserLike,
    quest: { id: string | number; title: string },
  ): REAEvent {
    return {
      id: this.generateId(holonId),
      timestamp: Date.now(),
      resource: {
        type: 'appreciation',
        quantity: 1,
        unit: 'completion',
      },
      provider: this.createUserAgent(participant),
      receiver: this.createHolonAgent(holonId),
      context: {
        holonId: String(holonId),
        questId: String(quest.id),
        note: quest.title,
      },
      eventType: 'quest:completed',
      status: 'confirmed',
    };
  }

  /** Time logged event. */
  static timeLogged(
    holonId: string | number,
    user: UserLike,
    hours: number,
    questId: string | number | null = null,
    note: string | null = null,
  ): REAEvent {
    return {
      id: this.generateId(holonId),
      timestamp: Date.now(),
      resource: {
        type: 'time',
        quantity: hours,
        unit: 'hours',
      },
      provider: this.createUserAgent(user),
      receiver: this.createHolonAgent(holonId),
      context: {
        holonId: String(holonId),
        questId: questId ? String(questId) : null,
        note,
      },
      eventType: 'quest:time_logged',
      status: 'confirmed',
    };
  }

  // ==================== Appreciation Events ====================

  /**
   * Dual-event appreciation exchange: returns `[sent, received]`.
   * `sent` is from the sender's perspective; `received` is the receiver's.
   */
  static appreciationExchange(
    holonId: string | number,
    sender: UserLike,
    receiver: UserLike,
    amount: number,
    reason: string,
    questId: string | number | null = null,
  ): REAEvent[] {
    const baseId = this.generateId(holonId);
    const timestamp = Date.now();
    const senderAgent = this.createUserAgent(sender);
    const receiverAgent = this.createUserAgent(receiver);

    return [
      // Sent event (from sender's perspective)
      {
        id: `${baseId}_sent`,
        timestamp,
        resource: {
          type: 'appreciation',
          quantity: amount,
          unit: 'kudos',
        },
        provider: senderAgent,
        receiver: receiverAgent,
        context: {
          holonId: String(holonId),
          questId: questId ? String(questId) : null,
          note: reason,
        },
        eventType: 'appreciation:sent',
        status: 'confirmed',
      },
      // Received event (from receiver's perspective)
      {
        id: `${baseId}_received`,
        timestamp,
        resource: {
          type: 'appreciation',
          quantity: amount,
          unit: 'kudos',
        },
        provider: senderAgent,
        receiver: receiverAgent,
        context: {
          holonId: String(holonId),
          questId: questId ? String(questId) : null,
          note: reason,
        },
        eventType: 'appreciation:received',
        status: 'confirmed',
      },
    ];
  }

  // ==================== Expense Events ====================

  /**
   * Expense events: one `expense:paid` (payer → external) plus one
   * `expense:share` per non-payer participant.
   */
  static expenseEvents(holonId: string | number, expense: ExpenseLike): REAEvent[] {
    const events: REAEvent[] = [];
    const baseId = this.generateId(holonId);
    const timestamp = expense.date || Date.now();
    const shareAmount = expense.amount / expense.splitWith.length;

    // Payer event - paid to external
    events.push({
      id: `${baseId}_paid`,
      timestamp,
      resource: {
        type: 'money',
        quantity: expense.amount,
        unit: expense.currency.toLowerCase(),
      },
      provider: { id: String(expense.paidBy), type: 'user' },
      receiver: this.createExternalAgent(expense.description),
      context: {
        holonId: String(holonId),
        expenseId: String(expense.id),
        note: expense.description,
      },
      eventType: 'expense:paid',
      status: 'confirmed',
    });

    // Share events - each participant's share (creates debt to payer)
    expense.splitWith.forEach((userId, index) => {
      if (String(userId) !== String(expense.paidBy)) {
        events.push({
          id: `${baseId}_share_${index}`,
          timestamp,
          resource: {
            type: 'money',
            quantity: shareAmount,
            unit: expense.currency.toLowerCase(),
          },
          provider: { id: String(expense.paidBy), type: 'user' },
          receiver: { id: String(userId), type: 'user' },
          context: {
            holonId: String(holonId),
            expenseId: String(expense.id),
            note: expense.description,
          },
          eventType: 'expense:share',
          status: 'confirmed',
        });
      }
    });

    return events;
  }

  /** Direct transfer event (user → user). */
  static directTransfer(
    holonId: string | number,
    sender: UserLike,
    receiver: UserLike,
    amount: number,
    currency: string,
    note: string | null = null,
  ): REAEvent {
    return {
      id: this.generateId(holonId),
      timestamp: Date.now(),
      resource: {
        type: 'money',
        quantity: amount,
        unit: currency.toLowerCase(),
      },
      provider: this.createUserAgent(sender),
      receiver: this.createUserAgent(receiver),
      context: {
        holonId: String(holonId),
        note,
      },
      eventType: 'transfer:direct',
      status: 'confirmed',
    };
  }

  // ==================== Library/Item Events ====================

  /** Item borrowed events: borrow + optional fee + optional deposit. */
  static itemBorrowed(
    holonId: string | number,
    borrower: UserLike,
    item: LibraryItemLike,
    credits: number,
    deposit: number,
  ): REAEvent[] {
    const baseId = this.generateId(holonId);
    const timestamp = Date.now();
    const events: REAEvent[] = [];

    // Item borrowed event
    events.push({
      id: `${baseId}_borrow`,
      timestamp,
      resource: {
        type: 'item',
        quantity: 1,
        unit: String(item.id),
        resourceId: item.id,
      },
      provider: { id: String(item.createdBy), type: 'user' },
      receiver: this.createUserAgent(borrower),
      context: {
        holonId: String(holonId),
        itemId: item.id,
      },
      eventType: 'item:borrowed',
      status: 'confirmed',
    });

    // Credits paid to owner
    if (credits > 0) {
      events.push({
        id: `${baseId}_fee`,
        timestamp,
        resource: {
          type: 'credit',
          quantity: credits,
          unit: 'credits',
        },
        provider: this.createUserAgent(borrower),
        receiver: { id: String(item.createdBy), type: 'user' },
        context: {
          holonId: String(holonId),
          itemId: item.id,
        },
        eventType: 'item:fee_paid',
        status: 'confirmed',
      });
    }

    // Deposit held by holon
    if (deposit > 0) {
      events.push({
        id: `${baseId}_deposit`,
        timestamp,
        resource: {
          type: 'credit',
          quantity: deposit,
          unit: 'credits',
        },
        provider: this.createUserAgent(borrower),
        receiver: this.createHolonAgent(holonId),
        context: {
          holonId: String(holonId),
          itemId: item.id,
        },
        eventType: 'item:deposit_held',
        status: 'pending',
      });
    }

    return events;
  }

  /** Item returned events: return + optional deposit return. */
  static itemReturned(
    holonId: string | number,
    borrower: UserLike,
    item: LibraryItemLike,
    depositAmount: number,
  ): REAEvent[] {
    const baseId = this.generateId(holonId);
    const timestamp = Date.now();
    const events: REAEvent[] = [];

    // Item returned event
    events.push({
      id: `${baseId}_return`,
      timestamp,
      resource: {
        type: 'item',
        quantity: 1,
        unit: String(item.id),
        resourceId: item.id,
      },
      provider: this.createUserAgent(borrower),
      receiver: { id: String(item.createdBy), type: 'user' },
      context: {
        holonId: String(holonId),
        itemId: item.id,
      },
      eventType: 'item:returned',
      status: 'confirmed',
    });

    // Deposit returned
    if (depositAmount > 0) {
      events.push({
        id: `${baseId}_deposit_return`,
        timestamp,
        resource: {
          type: 'credit',
          quantity: depositAmount,
          unit: 'credits',
        },
        provider: this.createHolonAgent(holonId),
        receiver: this.createUserAgent(borrower),
        context: {
          holonId: String(holonId),
          itemId: item.id,
        },
        eventType: 'item:deposit_returned',
        status: 'confirmed',
      });
    }

    return events;
  }

  // ==================== Offer/Want Events ====================

  /** Offer declared event. */
  static offerDeclared(
    holonId: string | number,
    user: UserLike,
    offer: string,
  ): REAEvent {
    return {
      id: this.generateId(holonId),
      timestamp: Date.now(),
      resource: {
        type: 'appreciation',
        quantity: 1,
        unit: 'offer',
      },
      provider: this.createUserAgent(user),
      receiver: this.createHolonAgent(holonId),
      context: {
        holonId: String(holonId),
        note: offer,
      },
      eventType: 'offer:declared',
      status: 'confirmed',
    };
  }

  /** Want declared event. */
  static wantDeclared(
    holonId: string | number,
    user: UserLike,
    want: string,
  ): REAEvent {
    return {
      id: this.generateId(holonId),
      timestamp: Date.now(),
      resource: {
        type: 'appreciation',
        quantity: 1,
        unit: 'want',
      },
      provider: this.createUserAgent(user),
      receiver: this.createHolonAgent(holonId),
      context: {
        holonId: String(holonId),
        note: want,
      },
      eventType: 'want:declared',
      status: 'confirmed',
    };
  }

  // ==================== Credit Events ====================

  /** Credit issued event (mutual-credit systems). */
  static creditIssued(
    holonId: string | number,
    issuer: UserLike,
    recipient: UserLike,
    amount: number,
    note: string | null = null,
  ): REAEvent {
    return {
      id: this.generateId(holonId),
      timestamp: Date.now(),
      resource: {
        type: 'credit',
        quantity: amount,
        unit: 'credits',
      },
      provider: this.createUserAgent(issuer),
      receiver: this.createUserAgent(recipient),
      context: {
        holonId: String(holonId),
        note,
      },
      eventType: 'credit:issued',
      status: 'confirmed',
    };
  }

  /** Credit transfer event (user → user). */
  static creditTransfer(
    holonId: string | number,
    sender: UserLike,
    recipient: UserLike,
    amount: number,
    note: string | null = null,
  ): REAEvent {
    return {
      id: this.generateId(holonId),
      timestamp: Date.now(),
      resource: {
        type: 'credit',
        quantity: amount,
        unit: 'credits',
      },
      provider: this.createUserAgent(sender),
      receiver: this.createUserAgent(recipient),
      context: {
        holonId: String(holonId),
        note,
      },
      eventType: 'credit:transfer',
      status: 'confirmed',
    };
  }
}

export default REAEventFactory;
