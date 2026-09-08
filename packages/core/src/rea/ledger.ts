// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ledger projection: what a lens write means in ValueFlows terms.
 *
 * Every UI persists the documents it edits — a quest with one more
 * participant, an expense with a changed split, a library item with a new
 * booking, a ticked shopping line, a role with a new holder. This module
 * reads such a document and says which `vf:EconomicEvent`s, `vf:Commitment`s
 * and `vf:Intent`s the `rea_events` ledger should hold for it, so the
 * accounting is derived from the record of truth instead of being remembered
 * by every button handler in every interface. `attachLedger` (see
 * `attach.ts`) runs it behind `holosphere.put` / `holosphere.delete`.
 *
 * Two rules make the derivation safe to run on every write:
 *
 *   1. Ids are stable. An event is keyed on the thing it describes (the
 *      expense id, the booking id, the (quest, member) pair), so re-deriving
 *      the same document upserts in place; a quest edited ten times still has
 *      one `quest:initiated`.
 *   2. Reconciliation is by subject. Each lens owns a set of event kinds; the
 *      events of those kinds that point at the written document and are no
 *      longer derived from it are retracted (a member who left, a split that
 *      shrank, a reservation cancelled before it started). Observed history
 *      is never retracted this way: a purchase stays bought after the line is
 *      cleared, a return stays returned.
 *
 * The completion family — `quest:completed`, `appreciation:*` at completion,
 * the hour expenses — is NOT derived here. Completing a quest goes through
 * `planTaskCompletion` + `executeCompletionPlan` in every UI, which prices
 * the events with the holon's value equation; this projection only fills in
 * what happens before and around that (initiation, joins, hours logged,
 * board intents), using the same stable ids so the two never double-count.
 *
 * Pure: no I/O, no clock beyond `ctx.now`.
 */

import { REAEventFactory } from './event-factory.js';
import type { REAEvent } from './event-store.js';

/** Lenses whose writes carry economic meaning. */
export const LEDGER_LENSES: readonly string[] = Object.freeze([
  'quests',
  'events',
  'expenses',
  'library',
  'checklists',
  'roles',
  'appreciations',
]);

/** The ledger lens itself. */
export const REA_EVENTS_LENS = 'rea_events';

export interface LedgerContext {
  holonId: string;
  lens: string;
  /** The record key the write landed on. */
  key: string;
  /** The document as written; `null` for a delete (or a tombstone). */
  next: Record<string, unknown> | null;
  /** The document previously at that key, when the local cache knew it. */
  prev?: Record<string, unknown> | null;
  /** The ledger as the local cache sees it — the basis for reconciliation. */
  existing: REAEvent[];
  /** Who performed the write (`actingAs`), when known. */
  actor?: string | number | null;
  now: number;
}

export interface LedgerUpsert {
  event: REAEvent;
  /**
   * The timestamp came from the document (an expense's `created`, a booking's
   * `created`). Otherwise the clock was used and an already-stored event
   * keeps the instant it was first recorded at.
   */
  pinTime: boolean;
  /**
   * Write only when no event with this id exists yet: the first observation
   * is the truth (a borrow fee at the price the item had when borrowed).
   */
  onlyIfAbsent?: boolean;
}

export interface LedgerPlan {
  upserts: LedgerUpsert[];
  /** Ids of ledger records to retract. */
  deletes: string[];
}

const EMPTY: LedgerPlan = { upserts: [], deletes: [] };

type Doc = Record<string, unknown>;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function isObj(v: unknown): v is Doc {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** ms from an ISO string, a ms number, or a numeric string; undefined otherwise. */
function toMs(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v) {
    const n = Number(v);
    if (Number.isFinite(n) && String(n) === v) return n;
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return undefined;
}

interface Person {
  id: string | number;
  username?: string;
  first_name?: string;
}

function person(v: unknown): Person | null {
  if (!isObj(v)) return null;
  const id = v.id;
  if (id == null || str(id) === '') return null;
  const out: Person = { id: id as string | number };
  if (typeof v.username === 'string' && v.username) out.username = v.username;
  if (typeof v.first_name === 'string' && v.first_name) out.first_name = v.first_name;
  return out;
}

/** A person from a bare id (with an optional display name). */
function personFromId(id: unknown, name?: unknown): Person | null {
  if (id == null || str(id) === '') return null;
  const out: Person = { id: id as string | number };
  if (typeof name === 'string' && name) out.username = name.replace(/^@/, '');
  return out;
}

function sameId(a: unknown, b: unknown): boolean {
  return str(a) !== '' && str(a) === str(b);
}

function ownedBySubject(
  existing: REAEvent[],
  kinds: readonly string[],
  matches: (e: REAEvent) => boolean,
): REAEvent[] {
  return existing.filter((e) => kinds.includes(String(e.eventType)) && matches(e));
}

/** Everything in `owned` that the plan no longer derives. */
function retractStale(owned: REAEvent[], upserts: LedgerUpsert[]): string[] {
  const keep = new Set(upserts.map((u) => u.event.id));
  return owned.map((e) => e.id).filter((id) => !keep.has(id));
}

function dayKey(v: unknown): string {
  const s = str(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function todayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// quests / events
// ---------------------------------------------------------------------------

/** Kinds this lens owns for reconciliation while the quest is open. */
const QUEST_LIVE_KINDS = ['quest:joined', 'quest:time_logged', 'need:claimed'] as const;
/** Kinds retracted when an unfinished quest is deleted. */
const QUEST_ALL_KINDS = [
  'quest:initiated',
  'quest:joined',
  'quest:time_logged',
  'need:published',
  'request:listed',
  'offer:listed',
  'need:claimed',
] as const;

function questEvents(e: REAEvent, questId: string): boolean {
  return str(e.context?.questId) === questId;
}

function boardKind(doc: Doc): 'offer' | 'request' | 'need' | null {
  const t = doc.type;
  return t === 'offer' || t === 'request' || t === 'need' ? t : null;
}

function questCreatedAt(doc: Doc, now: number): { at: number; pinned: boolean } {
  const at = toMs(doc.created) ?? toMs(doc.date);
  return at === undefined ? { at: now, pinned: false } : { at, pinned: true };
}

function planQuest(ctx: LedgerContext): LedgerPlan {
  const questId = ctx.key;
  const holon = ctx.holonId;
  const next = ctx.next;

  if (!next) {
    // A finished quest keeps its history; an abandoned one is withdrawn.
    const wasDone = str(ctx.prev?.status) === 'completed' || str(ctx.prev?.status) === 'fulfilled';
    if (wasDone) return EMPTY;
    return {
      upserts: [],
      deletes: ownedBySubject(ctx.existing, QUEST_ALL_KINDS, (e) => questEvents(e, questId)).map((e) => e.id),
    };
  }

  const upserts: LedgerUpsert[] = [];
  const title = str(next.title);
  const status = str(next.status);
  const initiator = person(next.initiator);
  const created = questCreatedAt(next, ctx.now);
  const kind = boardKind(next);

  if (kind) {
    // A board item is an intent; a claimed need adds the provider's commitment.
    const closed = status === 'fulfilled' || status === 'cancelled' || status === 'completed';
    if (initiator) {
      const itemType = next.item_type === 'service' ? 'service' : 'good';
      upserts.push({
        event: REAEventFactory.boardIntent(holon, kind, initiator, { id: questId, title, closed, itemType }, { at: created.at }),
        pinTime: created.pinned,
      });
    }
    if (kind === 'need' && next.claimedResponseId != null) {
      const responses = Array.isArray(next.responses) ? (next.responses as Doc[]) : [];
      const won = responses.find((r) => isObj(r) && sameId(r.id, next.claimedResponseId));
      const provider = isObj(won?.responder)
        ? personFromId(won!.responder.id, won!.responder.name)
        : null;
      if (provider) {
        const at = toMs(next.claimedAt);
        upserts.push({
          event: REAEventFactory.needClaimed(
            holon,
            provider,
            initiator,
            { id: questId, title, completed: status === 'fulfilled' },
            { at: at ?? ctx.now },
          ),
          pinTime: at !== undefined,
        });
      }
    }
  } else {
    if (initiator) {
      upserts.push({
        event: REAEventFactory.questInitiated(holon, initiator, { id: questId, title }, { at: created.at }),
        pinTime: created.pinned,
        // The completion plan re-emits this id at completion; the first
        // record (creation) is the one that dates the initiative.
        onlyIfAbsent: true,
      });
    }
    const completed = status === 'completed';
    const participants = Array.isArray(next.participants) ? next.participants : [];
    const seen = new Set<string>();
    for (const raw of participants) {
      const member = person(raw);
      if (!member || seen.has(str(member.id))) continue;
      seen.add(str(member.id));
      upserts.push({
        event: REAEventFactory.questJoined(holon, member, { id: questId, title, completed }, { at: ctx.now }),
        pinTime: false,
      });
    }
    const timeTracking = isObj(next.timeTracking) ? next.timeTracking : {};
    for (const [userId, raw] of Object.entries(timeTracking)) {
      const hours = Number(raw);
      if (!Number.isFinite(hours) || hours <= 0) continue;
      const member = participants.map(person).find((p) => p && sameId(p.id, userId)) ?? { id: userId };
      upserts.push({
        event: REAEventFactory.timeLogged(holon, member, hours, questId, title, { at: ctx.now }),
        pinTime: false,
      });
    }
  }

  const owned = ownedBySubject(ctx.existing, QUEST_LIVE_KINDS, (e) => questEvents(e, questId));
  return { upserts, deletes: retractStale(owned, upserts) };
}

// ---------------------------------------------------------------------------
// expenses
// ---------------------------------------------------------------------------

const EXPENSE_KINDS = ['expense:paid', 'expense:share'] as const;

function planExpense(ctx: LedgerContext): LedgerPlan {
  const expenseId = ctx.key;
  const owned = ownedBySubject(ctx.existing, EXPENSE_KINDS, (e) => str(e.context?.expenseId) === expenseId);
  const next = ctx.next;
  if (!next) return { upserts: [], deletes: owned.map((e) => e.id) };

  // Library borrow/return charges mirror a booking into the expenses lens;
  // the ledger already carries them as `item:fee_paid` from the library lens.
  if (next.type === 'borrow' || next.type === 'return') return { upserts: [], deletes: owned.map((e) => e.id) };

  const amount = Number(next.amount);
  const currency = str(next.currency);
  const paidBy = next.paidBy;
  if (!Number.isFinite(amount) || amount <= 0 || !currency || paidBy == null || str(paidBy) === '') {
    return { upserts: [], deletes: owned.map((e) => e.id) };
  }
  const splitWith = Array.isArray(next.splitWith) ? (next.splitWith as Array<string | number>) : [];
  const events = REAEventFactory.expenseEvents(ctx.holonId, {
    ...next,
    id: expenseId,
    amount,
    currency,
    description: str(next.description),
    paidBy: paidBy as string | number,
    splitWith,
  });
  const upserts = events.map((event) => ({ event, pinTime: true }));
  return { upserts, deletes: retractStale(owned, upserts) };
}

// ---------------------------------------------------------------------------
// library
// ---------------------------------------------------------------------------

const BOOKING_OPEN_KINDS = ['item:borrowed', 'item:fee_paid', 'item:deposit_held'] as const;

function itemEvents(e: REAEvent, itemId: string): boolean {
  return str(e.context?.itemId) === itemId;
}

function planLibrary(ctx: LedgerContext): LedgerPlan {
  const itemId = ctx.key;
  const holon = ctx.holonId;
  const next = ctx.next;
  const upserts: LedgerUpsert[] = [];
  const deletes: string[] = [];

  const ownerOf = (doc: Doc | null | undefined): Person | null =>
    personFromId(doc?.createdBy, doc?.createdByUsername);

  if (!next) {
    const owner = ownerOf(ctx.prev);
    const listed = ctx.existing.some((e) => e.eventType === 'item:listed' && itemEvents(e, itemId));
    if (owner && listed) {
      upserts.push({
        event: REAEventFactory.itemDelisted(holon, owner, { id: itemId, title: str(ctx.prev?.title ?? itemId) }, { at: ctx.now }),
        pinTime: false,
      });
    }
    return { upserts, deletes };
  }

  const owner = ownerOf(next);
  const item = { ...next, id: itemId };
  const createdAt = toMs(next.created);
  if (owner) {
    upserts.push({
      event: REAEventFactory.itemListed(holon, owner, { id: itemId, title: str(next.title ?? itemId) }, { at: createdAt ?? ctx.now }),
      pinTime: createdAt !== undefined,
      onlyIfAbsent: true,
    });
    // Listed again after a delisting: the delisting no longer holds.
    for (const e of ctx.existing) {
      if (e.eventType === 'item:delisted' && itemEvents(e, itemId)) deletes.push(e.id);
    }
  }

  const value = Number(next.value);
  const credits = Number.isFinite(value) && value > 0 ? value : 0;
  const bookings = Array.isArray(next.bookings) ? (next.bookings as Doc[]).filter(isObj) : [];
  const liveBookingIds = new Set<string>();

  for (const b of bookings) {
    const bookingId = str(b.id);
    const borrower = personFromId(b.borrowerId, b.borrower);
    if (!bookingId || !borrower) continue;
    liveBookingIds.add(bookingId);
    if (owner && sameId(borrower.id, owner.id)) continue; // owners don't charge themselves
    const at = toMs(b.created);
    const events = REAEventFactory.itemBorrowed(holon, borrower, item, credits, 0, {
      key: bookingId,
      at: at ?? ctx.now,
    });
    for (const event of events) {
      event.context = { ...event.context, bookingId, bookingStart: dayKey(b.start), bookingEnd: dayKey(b.end) };
      upserts.push({ event, pinTime: at !== undefined, onlyIfAbsent: true });
    }
  }

  // A borrow whose booking is gone: cancelled before it started (retract), or
  // over (custody came back — record the return once).
  const today = todayKey(ctx.now);
  const returned = new Set(
    ctx.existing
      .filter((e) => e.eventType === 'item:returned' && itemEvents(e, itemId))
      .map((e) => str(e.context?.bookingId)),
  );
  for (const e of ctx.existing) {
    if (!BOOKING_OPEN_KINDS.includes(e.eventType as (typeof BOOKING_OPEN_KINDS)[number])) continue;
    if (!itemEvents(e, itemId)) continue;
    const bookingId = str(e.context?.bookingId);
    if (!bookingId || liveBookingIds.has(bookingId)) continue;
    const start = str(e.context?.bookingStart);
    if (start && start > today) {
      deletes.push(e.id);
      continue;
    }
    if (e.eventType !== 'item:borrowed' || returned.has(bookingId)) continue;
    const borrower = personFromId(e.receiver?.id, e.receiver?.name);
    if (!borrower) continue;
    const returnedAt = toMs(next.returnedAt);
    const events = REAEventFactory.itemReturned(holon, borrower, item, 0, {
      key: bookingId,
      at: returnedAt ?? ctx.now,
    });
    for (const event of events) {
      event.context = { ...event.context, bookingId };
      upserts.push({ event, pinTime: returnedAt !== undefined, onlyIfAbsent: true });
    }
    returned.add(bookingId);
  }

  return { upserts, deletes };
}

// ---------------------------------------------------------------------------
// checklists (the shopping list)
// ---------------------------------------------------------------------------

function isShoppingList(doc: Doc, key: string): boolean {
  return doc.type === 'shopping' || key === 'shopping';
}

function planChecklist(ctx: LedgerContext): LedgerPlan {
  const next = ctx.next;
  if (!next || !isShoppingList(next, ctx.key)) return EMPTY; // purchases outlive the list
  const listId = ctx.key;
  const holon = ctx.holonId;
  const upserts: LedgerUpsert[] = [];
  const deletes: string[] = [];
  const bought = new Map<string, REAEvent>();
  for (const e of ctx.existing) {
    if (e.eventType === 'shopping:bought' && str(e.context?.listId) === listId) bought.set(str(e.context?.itemId), e);
  }
  const items = Array.isArray(next.items) ? (next.items as Doc[]).filter(isObj) : [];
  for (const line of items) {
    const itemId = str(line.id);
    if (!itemId) continue;
    if (line.checked === true) {
      const buyer = personFromId(line.checkedBy) ?? personFromId(ctx.actor);
      const quantity = Number(line.quantity);
      upserts.push({
        event: REAEventFactory.shoppingBought(
          holon,
          buyer,
          { listId, itemId, text: str(line.text), quantity: Number.isFinite(quantity) ? quantity : undefined },
          { at: toMs(line.checkedAt) ?? ctx.now },
        ),
        pinTime: toMs(line.checkedAt) !== undefined,
        onlyIfAbsent: true,
      });
    } else if (bought.has(itemId)) {
      deletes.push(bought.get(itemId)!.id); // un-ticked: it was not bought after all
    }
  }
  return { upserts, deletes };
}

// ---------------------------------------------------------------------------
// roles
// ---------------------------------------------------------------------------

function planRole(ctx: LedgerContext): LedgerPlan {
  const roleId = ctx.key;
  const holon = ctx.holonId;
  const owned = ownedBySubject(ctx.existing, ['role:taken'], (e) => str(e.context?.roleId) === roleId);
  const next = ctx.next;
  if (!next) return { upserts: [], deletes: owned.map((e) => e.id) };

  const role = { id: roleId, title: str(next.title ?? roleId) };
  const upserts: LedgerUpsert[] = [];
  const participants = Array.isArray(next.participants) ? next.participants : [];
  for (const raw of participants) {
    const member = person(raw);
    if (!member) continue;
    const at = toMs((raw as Doc).assigned_at);
    upserts.push({
      event: REAEventFactory.roleTaken(holon, member, role, null, { at: at ?? ctx.now }),
      pinTime: at !== undefined,
    });
  }
  const schedule = isObj(next.weekSchedule) ? next.weekSchedule : null;
  const assignments = schedule && Array.isArray(schedule.assignments) ? (schedule.assignments as Doc[]) : [];
  for (const day of assignments) {
    if (!isObj(day)) continue;
    const date = str(day.date);
    const users = Array.isArray(day.users) ? day.users : [];
    for (const raw of users) {
      const member = person(raw);
      if (!member || !date) continue;
      const at = toMs((raw as Doc).assignedAt);
      upserts.push({
        event: REAEventFactory.roleTaken(holon, member, role, date, { at: at ?? ctx.now }),
        pinTime: at !== undefined,
      });
    }
  }
  return { upserts, deletes: retractStale(owned, upserts) };
}

// ---------------------------------------------------------------------------
// appreciations (peer-to-peer, outside a quest)
// ---------------------------------------------------------------------------

function planAppreciation(ctx: LedgerContext): LedgerPlan {
  const holon = ctx.holonId;
  const key = ctx.key;
  const base = REAEventFactory.keyedBaseId(holon, 'appreciation', key);
  const owned = ctx.existing.filter((e) => e.id === `${base}_sent` || e.id === `${base}_received`);
  const next = ctx.next;
  if (!next) return { upserts: [], deletes: owned.map((e) => e.id) };
  const from = person(next.from);
  const to = person(next.to);
  const amount = Number(next.amount);
  if (!from || !to || !Number.isFinite(amount) || amount <= 0) {
    return { upserts: [], deletes: owned.map((e) => e.id) };
  }
  const at = toMs(next.date) ?? toMs(next.created);
  const events = REAEventFactory.appreciationExchange(holon, from, to, amount, str(next.reason), null, {
    key,
    at: at ?? ctx.now,
  });
  const upserts = events.map((event) => ({ event, pinTime: at !== undefined }));
  return { upserts, deletes: retractStale(owned, upserts) };
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

/**
 * The ledger records a write to `ctx.lens` should produce and retract. Lenses
 * outside {@link LEDGER_LENSES} yield an empty plan.
 */
export function planLedger(ctx: LedgerContext): LedgerPlan {
  if (!ctx.holonId || !ctx.key) return EMPTY;
  switch (ctx.lens) {
    case 'quests':
    case 'events':
      return planQuest(ctx);
    case 'expenses':
      return planExpense(ctx);
    case 'library':
      return planLibrary(ctx);
    case 'checklists':
      return planChecklist(ctx);
    case 'roles':
      return planRole(ctx);
    case 'appreciations':
      return planAppreciation(ctx);
    default:
      return EMPTY;
  }
}
