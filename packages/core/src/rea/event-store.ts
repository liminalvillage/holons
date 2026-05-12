/**
 * REA Event Store — persistent storage and retrieval of REA events.
 *
 * Ported from `packages/telegram-ui/src/domain/rea/REAEventStore.js` (the JS
 * source remains as a thin re-export wrapper for legacy import paths).
 *
 * Events are stored at: `holonId/rea_events`.
 */

import type { REAEventStoreLike } from '../scoring/aggregator.js';

/**
 * Minimal database surface used by the REA event store. Mirrors the
 * holosphere `DB` shape consumed by the UIs; intentionally narrower than
 * `tasks/types.HoloSphereLike` so a `holonId: string`-typed UI DB satisfies
 * it without contravariance issues. The store always converts the
 * `holonId` to a string before calling `put`, so requiring `string` here
 * matches the runtime call sites.
 */
export interface HoloSphereLike {
  put: (holonId: string, bucket: string, value: any) => Promise<unknown>;
  // `get` widens to accept `any` for the key so DBs that type the key as
  // `string` (telegram-ui Expenses/Library) and DBs that allow `string |
  // number` (telegram-ui Users) both satisfy the shape.
  get?: (holonId: string, bucket: string, key: any) => Promise<any>;
  getAll?: (holonId: string, bucket: string) => Promise<any[]>;
}

/**
 * Resource-Event-Agent event. The shape is intentionally open: REA events
 * are produced by `REAEventFactory` and consumed by `REAAggregator` /
 * downstream UIs; new fields are added as the domain grows. The known
 * fields below cover everything the current aggregator/store code reads.
 */
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
    questId?: string | number | null;
    itemId?: string | number;
    expenseId?: string | number;
    note?: string | null;
    [key: string]: any;
  };
  eventType?: string;
  status?: string;
  [key: string]: any;
}

/**
 * Query filters for events.
 */
export interface EventQueryFilters {
  resourceType?: string;
  eventType?: string;
  agentId?: string | number;
  fromDate?: number;
  toDate?: number;
  status?: string;
  [key: string]: any;
}

/**
 * REA Event Store for managing persistent storage and retrieval of REA events.
 *
 * @example
 * const store = new REAEventStore(db);
 * await store.put(holonId, event);
 * const events = await store.query(holonId, { agentId: userId });
 */
export class REAEventStore implements REAEventStoreLike {
  db: HoloSphereLike;

  constructor(db: HoloSphereLike) {
    this.db = db;
  }

  /**
   * Store a new REA event.
   */
  async put(holonId: string | number, event: REAEvent): Promise<REAEvent> {
    if (!event.id) {
      throw new Error('REA event must have an id');
    }
    await this.db.put(holonId.toString(), 'rea_events', event);
    return event;
  }

  /**
   * Store multiple REA events.
   */
  async putMany(holonId: string | number, events: REAEvent[]): Promise<REAEvent[]> {
    const results = await Promise.all(events.map((event) => this.put(holonId, event)));
    return results;
  }

  /**
   * Get a specific event by ID.
   */
  async get(holonId: string | number, eventId: string): Promise<REAEvent | null> {
    if (!this.db.get) return null;
    return (await this.db.get(holonId.toString(), 'rea_events', eventId)) as REAEvent | null;
  }

  /**
   * Get all events for a holon.
   */
  async getAll(holonId: string | number): Promise<REAEvent[]> {
    if (!this.db.getAll) return [];
    const events = await this.db.getAll(holonId.toString(), 'rea_events');
    return events || [];
  }

  /**
   * Query events with filters.
   */
  async query(holonId: string | number, filters: EventQueryFilters = {}): Promise<REAEvent[]> {
    const events = await this.getAll(holonId);

    return events.filter((event) => {
      // Filter by resource type
      if (filters.resourceType && event.resource?.type !== filters.resourceType) {
        return false;
      }

      // Filter by event type
      if (filters.eventType && event.eventType !== filters.eventType) {
        return false;
      }

      // Filter by agent (either provider or receiver)
      if (filters.agentId) {
        const agentId = String(filters.agentId);
        const providerId = String(event.provider?.id);
        const receiverId = String(event.receiver?.id);
        if (providerId !== agentId && receiverId !== agentId) {
          return false;
        }
      }

      // Filter by date range
      if (filters.fromDate && event.timestamp < filters.fromDate) {
        return false;
      }
      if (filters.toDate && event.timestamp > filters.toDate) {
        return false;
      }

      // Filter by status
      if (filters.status && event.status !== filters.status) {
        return false;
      }

      return true;
    });
  }

  /**
   * Get events where agent is the provider.
   */
  async getProviderEvents(
    holonId: string | number,
    agentId: string | number,
    resourceType: string | null = null,
  ): Promise<REAEvent[]> {
    const events = await this.query(holonId, { resourceType: resourceType ?? undefined });
    return events.filter((e) => String(e.provider?.id) === String(agentId));
  }

  /**
   * Get events where agent is the receiver.
   */
  async getReceiverEvents(
    holonId: string | number,
    agentId: string | number,
    resourceType: string | null = null,
  ): Promise<REAEvent[]> {
    const events = await this.query(holonId, { resourceType: resourceType ?? undefined });
    return events.filter((e) => String(e.receiver?.id) === String(agentId));
  }

  /**
   * Get events by event type.
   */
  async getByEventType(holonId: string | number, eventType: string): Promise<REAEvent[]> {
    return this.query(holonId, { eventType });
  }

  /**
   * Get events for a specific quest.
   */
  async getQuestEvents(holonId: string | number, questId: string | number): Promise<REAEvent[]> {
    const events = await this.getAll(holonId);
    return events.filter((e) => e.context?.questId === questId);
  }

  /**
   * Get events for a specific item (library).
   */
  async getItemEvents(holonId: string | number, itemId: string | number): Promise<REAEvent[]> {
    const events = await this.getAll(holonId);
    return events.filter(
      (e) => e.context?.itemId === itemId || e.resource?.resourceId === itemId,
    );
  }

  /**
   * Update an event's status.
   */
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

  /**
   * Count events matching filters.
   */
  async count(holonId: string | number, filters: EventQueryFilters = {}): Promise<number> {
    const events = await this.query(holonId, filters);
    return events.length;
  }

  /**
   * Sum resource quantities for matching events.
   */
  async sumQuantity(
    holonId: string | number,
    filters: EventQueryFilters = {},
  ): Promise<number> {
    const events = await this.query(holonId, filters);
    return events.reduce((sum, e) => sum + (e.resource?.quantity || 0), 0);
  }

  /**
   * Get events in a time range.
   */
  async getInTimeRange(
    holonId: string | number,
    fromDate: number,
    toDate: number,
  ): Promise<REAEvent[]> {
    return this.query(holonId, { fromDate, toDate });
  }
}

export default REAEventStore;
