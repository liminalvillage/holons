/**
 * REA Event Factory — produces properly structured REA events.
 *
 * Ported from `packages/telegram-ui/src/domain/rea/REAEventFactory.js` (the
 * JS source remains as a thin re-export for legacy import paths).
 */

import type { REAEvent } from './event-store.js';

interface Agent {
  id: string;
  type: 'user' | 'holon' | 'external';
  name: string;
}

/**
 * Factory class for creating REA (Resource-Event-Agent) events.
 *
 * @example
 * const event = REAEventFactory.questInitiated(holonId, user, quest);
 * await eventStore.put(holonId, event);
 */
export class REAEventFactory {
  /**
   * Generate a unique event ID.
   */
  static generateId(holonId: string | number): string {
    const timestamp = Date.now();
    const nonce = Math.random().toString(36).substring(2, 9);
    return `${holonId}_${timestamp}_${nonce}`;
  }

  /**
   * Create an Agent object from user data.
   */
  static createUserAgent(user: any): Agent {
    return {
      id: String(user.id),
      type: 'user',
      name: user.username || user.first_name || String(user.id),
    };
  }

  /**
   * Create a holon Agent.
   */
  static createHolonAgent(holonId: string | number, name: string | null = null): Agent {
    return {
      id: String(holonId),
      type: 'holon',
      name: name || String(holonId),
    };
  }

  /**
   * Create an external Agent (for expenses to external vendors).
   */
  static createExternalAgent(description: string): Agent {
    return {
      id: 'external',
      type: 'external',
      name: description,
    };
  }

  // ==================== Quest Events ====================

  /**
   * Create quest initiated event.
   */
  static questInitiated(holonId: string | number, initiator: any, quest: any): REAEvent {
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

  /**
   * Create quest completed event.
   */
  static questCompleted(holonId: string | number, participant: any, quest: any): REAEvent {
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

  /**
   * Create time logged event.
   */
  static timeLogged(
    holonId: string | number,
    user: any,
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
   * Create appreciation exchange events (dual-event pattern).
   * Returns two events: one for sent, one for received.
   */
  static appreciationExchange(
    holonId: string | number,
    sender: any,
    receiver: any,
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
   * Create expense events (payer + shares for each participant).
   */
  static expenseEvents(holonId: string | number, expense: any): REAEvent[] {
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
    expense.splitWith.forEach((userId: string | number, index: number) => {
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

  /**
   * Create direct transfer event.
   */
  static directTransfer(
    holonId: string | number,
    sender: any,
    receiver: any,
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

  /**
   * Create item borrowed events.
   */
  static itemBorrowed(
    holonId: string | number,
    borrower: any,
    item: any,
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
        unit: item.id,
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

  /**
   * Create item returned events.
   */
  static itemReturned(
    holonId: string | number,
    borrower: any,
    item: any,
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
        unit: item.id,
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

  /**
   * Create offer declared event.
   */
  static offerDeclared(holonId: string | number, user: any, offer: string): REAEvent {
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

  /**
   * Create want declared event.
   */
  static wantDeclared(holonId: string | number, user: any, want: string): REAEvent {
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

  /**
   * Create credit issued event (for mutual credit systems).
   */
  static creditIssued(
    holonId: string | number,
    issuer: any,
    recipient: any,
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

  /**
   * Create credit transfer event.
   */
  static creditTransfer(
    holonId: string | number,
    sender: any,
    recipient: any,
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
