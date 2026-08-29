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
import {
  economicEventProblems,
  normalizeReaEvent,
  type EconomicEvent,
  type VfAction,
} from './valueflows.js';

/**
 * A stored Resource-Event-Agent event: a `vf:EconomicEvent` (see
 * `valueflows.ts`) carrying the pre-ValueFlows projection alongside.
 *
 * Records written before the ValueFlows alignment may lack the ValueFlows
 * fields on disk; the store normalizes on read so every event it hands out
 * has both views. Loose by design — UIs add fields freely.
 */
export type REAEvent = EconomicEvent;

/** Optional filters accepted by `query()`. */
export interface EventQueryFilters {
  /** Legacy `resource.type` / `vf:resourceConformsTo` (same vocabulary). */
  resourceType?: string;
  /** Holons event kind, e.g. `quest:completed`. */
  eventType?: string;
  /** `vf:action`, e.g. `work`, `transfer`, `transferCustody`. */
  action?: VfAction;
  /** `vf:resourceConformsTo`. */
  resourceConformsTo?: string;
  /** `vf:inputOf` or `vf:outputOf` — the quest the event belongs to. */
  processId?: string | number;
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

  /**
   * Store a new REA event. Returns the event as stored: normalized so both
   * the ValueFlows and legacy views are present. Refuses anything that is
   * not a `vf:EconomicEvent` (no action, no agents, no measure, no instant).
   */
  async put(holonId: string | number, event: Partial<REAEvent> & { id: string }): Promise<REAEvent> {
    if (!event.id) {
      throw new Error('REA event must have an id');
    }
    const normalized = normalizeReaEvent(event as Record<string, unknown>) as REAEvent;
    const problems = economicEventProblems(normalized);
    if (problems.length) {
      throw new Error(`REA event ${event.id} is not a ValueFlows EconomicEvent: ${problems.join('; ')}`);
    }
    await this.db.put(String(holonId), 'rea_events', normalized);
    return normalized;
  }

  /** Store multiple REA events. */
  async putMany(
    holonId: string | number,
    events: Array<Partial<REAEvent> & { id: string }>,
  ): Promise<REAEvent[]> {
    const results = await Promise.all(events.map((event) => this.put(holonId, event)));
    return results;
  }

  /** Get a specific event by id. */
  async get(holonId: string | number, eventId: string): Promise<REAEvent | null> {
    if (!this.db.get) return null;
    const raw = await this.db.get(String(holonId), 'rea_events', eventId);
    return raw ? (normalizeReaEvent(raw as Record<string, unknown>) as REAEvent) : null;
  }

  /** Get all events for a holon. */
  async getAll(holonId: string | number): Promise<REAEvent[]> {
    if (!this.db.getAll) return [];
    const events = (await this.db.getAll(String(holonId), 'rea_events')) || [];
    return events
      .filter((e) => e && typeof e === 'object')
      .map((e) => normalizeReaEvent(e as Record<string, unknown>) as REAEvent);
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
      if (filters.action && event.action !== filters.action) {
        return false;
      }
      if (filters.resourceConformsTo && event.resourceConformsTo !== filters.resourceConformsTo) {
        return false;
      }
      if (filters.processId != null) {
        const pid = String(filters.processId);
        if (event.inputOf !== pid && event.outputOf !== pid) return false;
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
