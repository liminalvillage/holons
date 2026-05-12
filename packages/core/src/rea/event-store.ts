/**
 * REA Event Store — TS port of telegram-ui's REAEventStore.
 *
 * Stores and retrieves Resource-Event-Agent events via a HoloSphere-like
 * backend. Events are persisted at `(holonId, 'rea_events')` and queried
 * with an in-memory filter pass (matching the telegram-ui semantics).
 *
 * UI-agnostic: any backend implementing the minimal HoloSphere surface
 * (`put`/`get`/`getAll`) can plug in.
 */

import type { REAEventStoreLike } from '../scoring/aggregator.js';
import type { HoloSphereLike } from '../tasks/types.js';

/** Resource-Event-Agent event. Loose by design — UIs add fields freely. */
export interface REAEvent {
  id: string;
  timestamp: number;
  resource?: {
    type?: string;
    quantity?: number;
    unit?: string;
    resourceId?: string | number;
    [key: string]: any;
  };
  provider?: { id?: string | number; type?: string; name?: string; [key: string]: any };
  receiver?: { id?: string | number; type?: string; name?: string; [key: string]: any };
  context?: {
    holonId?: string;
    questId?: string | null;
    itemId?: string | number;
    expenseId?: string;
    note?: string | null;
    [key: string]: any;
  };
  eventType?: string;
  status?: string;
  [key: string]: any;
}

/** Optional filters accepted by `query()`. */
export interface EventQueryFilters {
  resourceType?: string;
  eventType?: string;
  agentId?: string | number;
  fromDate?: number;
  toDate?: number;
  status?: string;
  [key: string]: any;
}

/** HoloSphere surface used by the event store (adds optional getAll
 *  on top of the base HoloSphereLike `put` + optional `get`). */
interface EventDB extends HoloSphereLike {
  getAll?(holonId: string, bucket: string): Promise<any[]>;
}

/**
 * REA Event Store: persistent storage and retrieval of REA events.
 *
 * Behavior matches `packages/telegram-ui/src/domain/rea/REAEventStore.js`
 * (same bucket name, same query semantics).
 */
export class REAEventStore implements REAEventStoreLike {
  db: EventDB;

  constructor(db: HoloSphereLike) {
    this.db = db as EventDB;
  }

  /** Store a new REA event. Returns the event. */
  async put(holonId: string | number, event: REAEvent): Promise<REAEvent> {
    if (!event.id) {
      throw new Error('REA event must have an id');
    }
    await this.db.put(String(holonId), 'rea_events', event);
    return event;
  }

  /** Store multiple REA events. */
  async putMany(holonId: string | number, events: REAEvent[]): Promise<REAEvent[]> {
    const results = await Promise.all(events.map((event) => this.put(holonId, event)));
    return results;
  }

  /** Get a specific event by id. */
  async get(holonId: string | number, eventId: string): Promise<REAEvent | null> {
    if (!this.db.get) return null;
    return (await this.db.get(String(holonId), 'rea_events', eventId)) as REAEvent | null;
  }

  /** Get all events for a holon. */
  async getAll(holonId: string | number): Promise<REAEvent[]> {
    if (!this.db.getAll) return [];
    const events = await this.db.getAll(String(holonId), 'rea_events');
    return (events as REAEvent[]) || [];
  }

  /** Query events with filters (in-memory filter pass). */
  async query(
    holonId: string | number,
    filters: EventQueryFilters = {},
  ): Promise<REAEvent[]> {
    const events = await this.getAll(holonId);

    return events.filter((event) => {
      if (filters.resourceType && event.resource?.type !== filters.resourceType) {
        return false;
      }
      if (filters.eventType && event.eventType !== filters.eventType) {
        return false;
      }
      if (filters.agentId) {
        const agentId = String(filters.agentId);
        const providerId = String(event.provider?.id);
        const receiverId = String(event.receiver?.id);
        if (providerId !== agentId && receiverId !== agentId) {
          return false;
        }
      }
      if (filters.fromDate && event.timestamp < filters.fromDate) {
        return false;
      }
      if (filters.toDate && event.timestamp > filters.toDate) {
        return false;
      }
      if (filters.status && event.status !== filters.status) {
        return false;
      }
      return true;
    });
  }

  /** Get events where agent is the provider. */
  async getProviderEvents(
    holonId: string | number,
    agentId: string | number,
    resourceType: string | null = null,
  ): Promise<REAEvent[]> {
    const events = await this.query(holonId, resourceType ? { resourceType } : {});
    return events.filter((e) => String(e.provider?.id) === String(agentId));
  }

  /** Get events where agent is the receiver. */
  async getReceiverEvents(
    holonId: string | number,
    agentId: string | number,
    resourceType: string | null = null,
  ): Promise<REAEvent[]> {
    const events = await this.query(holonId, resourceType ? { resourceType } : {});
    return events.filter((e) => String(e.receiver?.id) === String(agentId));
  }

  /** Get events by event type. */
  async getByEventType(
    holonId: string | number,
    eventType: string,
  ): Promise<REAEvent[]> {
    return this.query(holonId, { eventType });
  }

  /** Get events for a specific quest. */
  async getQuestEvents(
    holonId: string | number,
    questId: string | number,
  ): Promise<REAEvent[]> {
    const events = await this.getAll(holonId);
    return events.filter((e) => String(e.context?.questId) === String(questId));
  }

  /** Get events for a specific library item. */
  async getItemEvents(
    holonId: string | number,
    itemId: string | number,
  ): Promise<REAEvent[]> {
    const events = await this.getAll(holonId);
    return events.filter(
      (e) =>
        String(e.context?.itemId) === String(itemId) ||
        String(e.resource?.resourceId) === String(itemId),
    );
  }

  /** Update an event's status. */
  async updateStatus(
    holonId: string | number,
    eventId: string,
    status: string,
  ): Promise<REAEvent | null> {
    const event = await this.get(holonId, eventId);
    if (!event) return null;
    event.status = status;
    await this.put(holonId, event);
    return event;
  }

  /** Count events matching filters. */
  async count(
    holonId: string | number,
    filters: EventQueryFilters = {},
  ): Promise<number> {
    const events = await this.query(holonId, filters);
    return events.length;
  }

  /** Sum resource quantities for matching events. */
  async sumQuantity(
    holonId: string | number,
    filters: EventQueryFilters = {},
  ): Promise<number> {
    const events = await this.query(holonId, filters);
    return events.reduce((sum, e) => sum + (e.resource?.quantity || 0), 0);
  }

  /** Get events in a time range. */
  async getInTimeRange(
    holonId: string | number,
    fromDate: number,
    toDate: number,
  ): Promise<REAEvent[]> {
    return this.query(holonId, { fromDate, toDate });
  }
}

export default REAEventStore;
