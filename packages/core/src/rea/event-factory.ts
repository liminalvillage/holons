/**
 * REA Event Factory — TS port of telegram-ui's REAEventFactory.
 *
 * Static factory class producing properly structured Resource-Event-Agent
 * events: quests, appreciation, expenses, time logs, items, offers/wants,
 * credits. Every event is a ValueFlows `EconomicEvent` (see `valueflows.ts`)
 * and also carries the original JS factory's shape, so existing stored
 * events keep aggregating correctly.
 */

import type { REAEvent } from './event-store.js';
import { normalizeAgent, normalizeReaEvent, type VfAgent } from './valueflows.js';

/**
 * Give an event both its ValueFlows and legacy views. Every factory method
 * returns through here so the stored record is a `vf:EconomicEvent`.
 */
function vf(event: Record<string, unknown>): REAEvent {
  return normalizeReaEvent(event) as REAEvent;
}

/**
 * Knobs shared by the factory methods that the ledger projection
 * (`ledger.ts`) drives from stored documents:
 *   - `at`: the instant the thing happened, taken from the document (an
 *     expense's `created`, a booking's `created`) rather than the wall clock,
 *     so a re-put of an old record does not move the event in time.
 *   - `key`: a stable id part (a booking id, an appreciation record id) for
 *     events that would otherwise get a fresh random id per call, so
 *     re-deriving the same document upserts instead of duplicating.
 */
export interface FactoryOptions {
  at?: number;
  key?: string | number | null;
}

function when(opts?: FactoryOptions): number {
  return typeof opts?.at === 'number' && Number.isFinite(opts.at) ? opts.at : Date.now();
}

/** Loose user shape accepted by the factory (id required, name fields optional). */
interface UserLike {
  id: string | number;
  username?: string;
  first_name?: string;
  [key: string]: any;
}

/**
 * Agent reference produced by the factory: a `vf:Person` (users) or
 * `vf:Organization` (holons, the outside world), with the legacy `type`.
 */
type Agent = VfAgent;

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

  /**
   * Base id for a family of events keyed on an external record (a booking, an
   * appreciation record): stable when `key` is given, random otherwise.
   */
  static keyedBaseId(holonId: string | number, kind: string, key: string | number | null | undefined): string {
    return key == null || String(key) === ''
      ? this.generateId(holonId)
      : `${holonId}_${kind}_${String(key)}`;
  }

  /** Build a user Agent from a user-like object. */
  static createUserAgent(user: UserLike): Agent {
    return normalizeAgent({
      id: String(user.id),
      type: 'user',
      name: user.username || user.first_name || String(user.id),
    });
  }

  /** Build a holon Agent. */
  static createHolonAgent(holonId: string | number, name: string | null = null): Agent {
    return normalizeAgent({
      id: String(holonId),
      type: 'holon',
      name: name || String(holonId),
    });
  }

  /** Build an external Agent (used as the receiver for expense:paid). */
  static createExternalAgent(description: string): Agent {
    return normalizeAgent({
      id: 'external',
      type: 'external',
      name: description,
    });
  }

  // ==================== Quest Events ====================

  /** Quest initiated event. */
  static questInitiated(
    holonId: string | number,
    initiator: UserLike,
    quest: { id: string | number; title: string },
    opts?: FactoryOptions,
  ): REAEvent {
    return vf({
      id: this.stableEventId(holonId, 'quest_initiated', initiator.id, quest.id),
      timestamp: when(opts),
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
    });
  }

  /** Quest completed event. */
  static questCompleted(
    holonId: string | number,
    participant: UserLike,
    quest: { id: string | number; title: string },
  ): REAEvent {
    return vf({
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
    });
  }

  /** Time logged event. */
  static timeLogged(
    holonId: string | number,
    user: UserLike,
    hours: number,
    questId: string | number | null = null,
    note: string | null = null,
    opts?: FactoryOptions,
  ): REAEvent {
    return vf({
      id: this.stableEventId(holonId, 'quest_time_logged', user.id, questId),
      timestamp: when(opts),
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
    });
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
    opts?: FactoryOptions,
  ): REAEvent[] {
    // Stable within a (sender, receiver, quest) tuple so a re-completed task
    // collapses its appreciation pair. Ad-hoc appreciation outside a quest
    // (questId == null) is keyed on `opts.key` (its own record id) when the
    // caller has one, and gets a fresh random base id per call otherwise.
    const baseId =
      questId == null && opts?.key != null
        ? this.keyedBaseId(holonId, 'appreciation', opts.key)
        : this.stableEventId(holonId, 'appreciation', sender.id, receiver.id, questId);
    const timestamp = when(opts);
    const senderAgent = this.createUserAgent(sender);
    const receiverAgent = this.createUserAgent(receiver);

    return [
      vf({
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
      }),
      vf({
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
      }),
    ];
  }

  // ==================== Expense Events ====================

  /**
   * Expense events: one `expense:paid` plus one `expense:share` per non-payer.
   *
   * Ids are stable, keyed on `expense.id` (`<holon>_expense_<id>_paid` /
   * `_share_<index>`), so re-emitting the same expense — on edit, on a second
   * write from another UI, or during a backfill — upserts in place instead of
   * appending duplicates that would double-count balances. Falls back to a
   * random base id only when `expense.id` is missing.
   */
  static expenseEvents(holonId: string | number, expense: ExpenseLike): REAEvent[] {
    const events: REAEvent[] = [];
    const baseId = this.stableEventId(holonId, 'expense', expense.id);
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
    const splitWith = Array.isArray(expense.splitWith) ? expense.splitWith : [];
    const shareAmount = splitWith.length > 0 ? expense.amount / splitWith.length : 0;

    events.push(vf({
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
    }));

    splitWith.forEach((userId, index) => {
      if (String(userId) !== String(expense.paidBy)) {
        events.push(vf({
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
        }));
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
    return vf({
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
    });
  }

  // ==================== Library/Item Events ====================

  /** Item borrowed events: borrow + optional fee + optional deposit. */
  static itemBorrowed(
    holonId: string | number,
    borrower: UserLike,
    item: LibraryItemLike,
    credits: number,
    deposit: number,
    opts?: FactoryOptions,
  ): REAEvent[] {
    const baseId = this.keyedBaseId(holonId, 'booking', opts?.key);
    const timestamp = when(opts);
    const events: REAEvent[] = [];

    events.push(vf({
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
    }));

    if (credits > 0) {
      events.push(vf({
        id: `${baseId}_fee`,
        timestamp,
        resource: { type: 'credit', quantity: credits, unit: 'credits' },
        provider: this.createUserAgent(borrower),
        receiver: { id: String(item.createdBy), type: 'user' },
        context: { holonId: String(holonId), itemId: item.id },
        eventType: 'item:fee_paid',
        status: 'confirmed',
      }));
    }

    if (deposit > 0) {
      events.push(vf({
        id: `${baseId}_deposit`,
        timestamp,
        resource: { type: 'credit', quantity: deposit, unit: 'credits' },
        provider: this.createUserAgent(borrower),
        receiver: this.createHolonAgent(holonId),
        context: { holonId: String(holonId), itemId: item.id },
        eventType: 'item:deposit_held',
        status: 'pending',
      }));
    }

    return events;
  }

  /** Item returned events: return + optional deposit return. */
  static itemReturned(
    holonId: string | number,
    borrower: UserLike,
    item: LibraryItemLike,
    depositAmount: number,
    opts?: FactoryOptions,
  ): REAEvent[] {
    const baseId = this.keyedBaseId(holonId, 'booking', opts?.key);
    const timestamp = when(opts);
    const events: REAEvent[] = [];

    events.push(vf({
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
    }));

    if (depositAmount > 0) {
      events.push(vf({
        id: `${baseId}_deposit_return`,
        timestamp,
        resource: { type: 'credit', quantity: depositAmount, unit: 'credits' },
        provider: this.createHolonAgent(holonId),
        receiver: this.createUserAgent(borrower),
        context: { holonId: String(holonId), itemId: item.id },
        eventType: 'item:deposit_returned',
        status: 'confirmed',
      }));
    }

    return events;
  }

  /**
   * Item put on the commons shelf: one more library item on hand for the
   * holon, contributed by its owner. Stable per item.
   */
  static itemListed(
    holonId: string | number,
    owner: UserLike,
    item: LibraryItemLike & { title?: string },
    opts?: FactoryOptions,
  ): REAEvent {
    return vf({
      id: this.stableEventId(holonId, 'item_listed', item.id),
      timestamp: when(opts),
      resource: { type: 'item', quantity: 1, unit: 'one', resourceId: item.id },
      provider: this.createUserAgent(owner),
      receiver: this.createHolonAgent(holonId),
      context: { holonId: String(holonId), itemId: item.id, note: String(item.title ?? item.id) },
      eventType: 'item:listed',
      status: 'confirmed',
    });
  }

  /** Item taken off the shelf for good. Stable per item. */
  static itemDelisted(
    holonId: string | number,
    owner: UserLike,
    item: LibraryItemLike & { title?: string },
    opts?: FactoryOptions,
  ): REAEvent {
    return vf({
      id: this.stableEventId(holonId, 'item_delisted', item.id),
      timestamp: when(opts),
      resource: { type: 'item', quantity: 1, unit: 'one', resourceId: item.id },
      provider: this.createHolonAgent(holonId),
      receiver: this.createUserAgent(owner),
      context: { holonId: String(holonId), itemId: item.id, note: String(item.title ?? item.id) },
      eventType: 'item:delisted',
      status: 'confirmed',
    });
  }

  // ==================== Shopping Events ====================

  /**
   * A ticked shopping-list line: `buyer` brought `quantity` of the thing in
   * for the holon. Stable per (list, line).
   */
  static shoppingBought(
    holonId: string | number,
    buyer: UserLike | null,
    line: { listId: string | number; itemId: string | number; text: string; quantity?: number },
    opts?: FactoryOptions,
  ): REAEvent {
    const qty = typeof line.quantity === 'number' && line.quantity > 0 ? line.quantity : 1;
    return vf({
      id: this.stableEventId(holonId, 'shopping_bought', line.listId, line.itemId),
      timestamp: when(opts),
      resource: { type: 'item', quantity: qty, unit: 'one', resourceId: String(line.itemId) },
      provider: buyer ? this.createUserAgent(buyer) : this.createExternalAgent('market'),
      receiver: this.createHolonAgent(holonId),
      context: {
        holonId: String(holonId),
        listId: String(line.listId),
        itemId: String(line.itemId),
        note: line.text,
      },
      eventType: 'shopping:bought',
      status: 'confirmed',
    });
  }

  // ==================== Planning: commitments ====================

  /**
   * A member joined a quest: a `vf:Commitment` to work on that process. The
   * hours are unknown until logged, so it carries no measure. `finished`
   * flips once the quest completes. Stable per (quest, member).
   */
  static questJoined(
    holonId: string | number,
    member: UserLike,
    quest: { id: string | number; title: string; completed?: boolean },
    opts?: FactoryOptions,
  ): REAEvent {
    return vf({
      id: this.stableEventId(holonId, 'quest_joined', member.id, quest.id),
      vfType: 'Commitment',
      timestamp: when(opts),
      resource: { type: 'time' },
      provider: this.createUserAgent(member),
      receiver: this.createHolonAgent(holonId),
      context: { holonId: String(holonId), questId: String(quest.id), note: quest.title },
      eventType: 'quest:joined',
      finished: !!quest.completed,
      status: quest.completed ? 'confirmed' : 'pending',
    });
  }

  /**
   * A member holds a role — permanently (`day` omitted) or for one day. A
   * `vf:Commitment` to work; stable per (role, member[, day]).
   */
  static roleTaken(
    holonId: string | number,
    member: UserLike,
    role: { id: string | number; title: string },
    day: string | null = null,
    opts?: FactoryOptions,
  ): REAEvent {
    return vf({
      id: this.stableEventId(holonId, 'role_taken', role.id, member.id, day ?? 'permanent'),
      vfType: 'Commitment',
      timestamp: when(opts),
      resource: { type: 'time' },
      provider: this.createUserAgent(member),
      receiver: this.createHolonAgent(holonId),
      context: {
        holonId: String(holonId),
        roleId: String(role.id),
        day,
        note: day ? `${role.title} · ${day}` : role.title,
      },
      eventType: 'role:taken',
      status: 'pending',
    });
  }

  /**
   * A member signed up for a shift: a `vf:Commitment` of the shift's hours.
   * Stable per (shift occurrence, member).
   */
  static shiftAccepted(
    holonId: string | number,
    member: UserLike,
    shift: { id: string; title: string; start: number; end: number },
    opts?: FactoryOptions,
  ): REAEvent {
    const hours = Math.max(0, (Number(shift.end) - Number(shift.start)) / 3600);
    return vf({
      id: this.stableEventId(holonId, 'shift_accepted', shift.id, member.id),
      vfType: 'Commitment',
      timestamp: when(opts),
      resource: { type: 'time', quantity: hours, unit: 'hours' },
      provider: this.createUserAgent(member),
      receiver: this.createHolonAgent(holonId),
      context: { holonId: String(holonId), shiftId: shift.id, note: shift.title },
      eventType: 'shift:accepted',
      status: 'pending',
    });
  }

  /**
   * A provider's response was accepted on a need: a `vf:Commitment` to
   * deliver it to the asker. Stable per need (one claim wins).
   */
  static needClaimed(
    holonId: string | number,
    provider: UserLike,
    asker: UserLike | null,
    need: { id: string | number; title: string; completed?: boolean },
    opts?: FactoryOptions,
  ): REAEvent {
    return vf({
      id: this.stableEventId(holonId, 'need_claimed', need.id),
      vfType: 'Commitment',
      timestamp: when(opts),
      resource: { type: 'item' },
      provider: this.createUserAgent(provider),
      receiver: asker ? this.createUserAgent(asker) : this.createHolonAgent(holonId),
      context: { holonId: String(holonId), questId: String(need.id), note: need.title },
      eventType: 'need:claimed',
      finished: !!need.completed,
      status: need.completed ? 'confirmed' : 'pending',
    });
  }

  // ==================== Planning: intents ====================

  /**
   * A board item is a `vf:Intent`: a need or request wants something in
   * (the asker receives), an offer wants something out (the offerer
   * provides). `closed` marks it fulfilled or withdrawn. Stable per item.
   */
  static boardIntent(
    holonId: string | number,
    kind: 'need' | 'request' | 'offer',
    initiator: UserLike,
    item: { id: string | number; title: string; closed?: boolean; itemType?: 'good' | 'service' },
    opts?: FactoryOptions,
  ): REAEvent {
    const eventType = kind === 'need' ? 'need:published' : kind === 'offer' ? 'offer:listed' : 'request:listed';
    const person = this.createUserAgent(initiator);
    const holon = this.createHolonAgent(holonId);
    const service = item.itemType === 'service';
    return vf({
      id: this.stableEventId(holonId, eventType.replace(':', '_'), item.id),
      vfType: 'Intent',
      timestamp: when(opts),
      action: service ? 'deliverService' : 'transfer',
      resource: { type: service ? 'time' : 'item', quantity: 1, unit: 'one' },
      provider: kind === 'offer' ? person : holon,
      receiver: kind === 'offer' ? holon : person,
      context: { holonId: String(holonId), questId: String(item.id), note: item.title },
      eventType,
      finished: !!item.closed,
      status: item.closed ? 'confirmed' : 'pending',
    });
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
    return vf({
      id: this.generateId(holonId),
      timestamp: Date.now(),
      resource: { type: 'credit', quantity: amount, unit: 'credits' },
      provider: this.createUserAgent(issuer),
      receiver: this.createUserAgent(recipient),
      context: { holonId: String(holonId), note },
      eventType: 'credit:issued',
      status: 'confirmed',
    });
  }

  /** Credit transfer event (user -> user). */
  static creditTransfer(
    holonId: string | number,
    sender: UserLike,
    recipient: UserLike,
    amount: number,
    note: string | null = null,
  ): REAEvent {
    return vf({
      id: this.generateId(holonId),
      timestamp: Date.now(),
      resource: { type: 'credit', quantity: amount, unit: 'credits' },
      provider: this.createUserAgent(sender),
      receiver: this.createUserAgent(recipient),
      context: { holonId: String(holonId), note },
      eventType: 'credit:transfer',
      status: 'confirmed',
    });
  }
}

export default REAEventFactory;
