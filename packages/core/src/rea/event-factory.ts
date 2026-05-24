/**
 * REA Event Factory — TS port of telegram-ui's REAEventFactory.
 *
 * Static factory class producing properly structured Resource-Event-Agent
 * events: quests, appreciation, expenses, time logs, items, offers/wants,
 * credits. Output matches the original JS factory so existing stored events
 * keep aggregating correctly.
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
  /** Canonical creation timestamp (ISO). */
  created?: string;
  /** Legacy field — older bot/web records used `date: ms`. Read for back-compat. */
  date?: number | string;
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

  /**
   * Deterministic event id for completion-path events. Re-completing the
   * same (task, user) upserts the existing event in `rea_events` instead of
   * appending duplicates, so aggregates don't double-count accidental
   * double-clicks. Recurring tasks fire as fresh quests with new `task.id`s
   * (Scheduler.js line 218), so each occurrence gets its own event.
   *
   * Falls back to `generateId` when any keying part is missing — keeps the
   * "new event per call" semantics for ad-hoc cases (e.g. appreciation
   * outside a task context).
   */
  static stableEventId(
    holonId: string | number,
    eventKind: string,
    ...keyParts: Array<string | number | null | undefined>
  ): string {
    const normalized = keyParts.map((p) => (p == null ? '' : String(p)));
    if (normalized.some((p) => p === '')) return this.generateId(holonId);
    return `${holonId}_${eventKind}_${normalized.join('_')}`;
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
      id: this.stableEventId(holonId, 'quest_initiated', initiator.id, quest.id),
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
      id: this.stableEventId(holonId, 'quest_completed', participant.id, quest.id),
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
      id: this.stableEventId(holonId, 'quest_time_logged', user.id, questId),
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
    // Stable within a (sender, receiver, quest) tuple so a re-completed task
    // collapses its appreciation pair. Ad-hoc appreciation outside a quest
    // (questId == null) still gets a fresh random base id per call.
    const baseId = this.stableEventId(
      holonId,
      'appreciation',
      sender.id,
      receiver.id,
      questId,
    );
    const timestamp = Date.now();
    const senderAgent = this.createUserAgent(sender);
    const receiverAgent = this.createUserAgent(receiver);

    return [
      {
        id: `${baseId}_sent`,
        timestamp,
        resource: { type: 'appreciation', quantity: amount, unit: 'kudos' },
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
      {
        id: `${baseId}_received`,
        timestamp,
        resource: { type: 'appreciation', quantity: amount, unit: 'kudos' },
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

  /** Expense events: one `expense:paid` plus one `expense:share` per non-payer. */
  static expenseEvents(holonId: string | number, expense: ExpenseLike): REAEvent[] {
    const events: REAEvent[] = [];
    const baseId = this.generateId(holonId);
    // Read either the canonical `created` (ISO) or legacy `date` (ms / ISO string) for back-compat.
    const timestamp = (() => {
      const c = (expense as any).created;
      if (typeof c === 'string') {
        const t = Date.parse(c);
        if (Number.isFinite(t)) return t;
      }
      const d = (expense as any).date;
      if (typeof d === 'number' && Number.isFinite(d)) return d;
      if (typeof d === 'string') {
        const n = parseInt(d, 10);
        if (Number.isFinite(n) && String(n) === d) return n;
        const t = Date.parse(d);
        if (Number.isFinite(t)) return t;
      }
      return Date.now();
    })();
    const shareAmount = expense.amount / expense.splitWith.length;

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

  /** Direct transfer event (user -> user). */
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
      context: { holonId: String(holonId), note },
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
      context: { holonId: String(holonId), itemId: item.id },
      eventType: 'item:borrowed',
      status: 'confirmed',
    });

    if (credits > 0) {
      events.push({
        id: `${baseId}_fee`,
        timestamp,
        resource: { type: 'credit', quantity: credits, unit: 'credits' },
        provider: this.createUserAgent(borrower),
        receiver: { id: String(item.createdBy), type: 'user' },
        context: { holonId: String(holonId), itemId: item.id },
        eventType: 'item:fee_paid',
        status: 'confirmed',
      });
    }

    if (deposit > 0) {
      events.push({
        id: `${baseId}_deposit`,
        timestamp,
        resource: { type: 'credit', quantity: deposit, unit: 'credits' },
        provider: this.createUserAgent(borrower),
        receiver: this.createHolonAgent(holonId),
        context: { holonId: String(holonId), itemId: item.id },
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
      context: { holonId: String(holonId), itemId: item.id },
      eventType: 'item:returned',
      status: 'confirmed',
    });

    if (depositAmount > 0) {
      events.push({
        id: `${baseId}_deposit_return`,
        timestamp,
        resource: { type: 'credit', quantity: depositAmount, unit: 'credits' },
        provider: this.createHolonAgent(holonId),
        receiver: this.createUserAgent(borrower),
        context: { holonId: String(holonId), itemId: item.id },
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
      resource: { type: 'appreciation', quantity: 1, unit: 'offer' },
      provider: this.createUserAgent(user),
      receiver: this.createHolonAgent(holonId),
      context: { holonId: String(holonId), note: offer },
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
      resource: { type: 'appreciation', quantity: 1, unit: 'want' },
      provider: this.createUserAgent(user),
      receiver: this.createHolonAgent(holonId),
      context: { holonId: String(holonId), note: want },
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
      resource: { type: 'credit', quantity: amount, unit: 'credits' },
      provider: this.createUserAgent(issuer),
      receiver: this.createUserAgent(recipient),
      context: { holonId: String(holonId), note },
      eventType: 'credit:issued',
      status: 'confirmed',
    };
  }

  /** Credit transfer event (user -> user). */
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
      resource: { type: 'credit', quantity: amount, unit: 'credits' },
      provider: this.createUserAgent(sender),
      receiver: this.createUserAgent(recipient),
      context: { holonId: String(holonId), note },
      eventType: 'credit:transfer',
      status: 'confirmed',
    };
  }
}

export default REAEventFactory;
