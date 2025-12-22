/**
 * @fileoverview REA Event Store for managing persistent REA events.
 * @module src/domain/rea/REAEventStore
 */

/**
 * @typedef {Object} REAEvent - Resource-Event-Agent event object
 * @typedef {Object} EventQueryFilters - Query filters for events
 */

/**
 * REA Event Store for managing persistent storage and retrieval of REA events.
 *
 * @class REAEventStore
 * @description Stores and retrieves Resource-Event-Agent events using HoloSphere/GunDB.
 * Events are stored at: holonId/rea_events
 *
 * @property {DB} db - Database instance for storage
 *
 * @example
 * const store = new REAEventStore(db);
 * await store.put(holonId, event);
 * const events = await store.query(holonId, { agentId: userId });
 */
export class REAEventStore {
    /**
     * @param {Object} db - Database instance (HoloSphere/GunDB wrapper)
     */
    constructor(db) {
        this.db = db;
    }

    /**
     * Store a new REA event
     * @param {string} holonId - Holon context
     * @param {REAEvent} event - The event to store
     * @returns {Promise<REAEvent>} The stored event
     */
    async put(holonId, event) {
        if (!event.id) {
            throw new Error('REA event must have an id');
        }
        await this.db.put(holonId.toString(), 'rea_events', event);
        return event;
    }

    /**
     * Store multiple REA events
     * @param {string} holonId - Holon context
     * @param {REAEvent[]} events - Events to store
     * @returns {Promise<REAEvent[]>} The stored events
     */
    async putMany(holonId, events) {
        const results = await Promise.all(
            events.map(event => this.put(holonId, event))
        );
        return results;
    }

    /**
     * Get a specific event by ID
     * @param {string} holonId - Holon context
     * @param {string} eventId - Event ID
     * @returns {Promise<REAEvent|null>} The event or null
     */
    async get(holonId, eventId) {
        return this.db.get(holonId.toString(), 'rea_events', eventId);
    }

    /**
     * Get all events for a holon
     * @param {string} holonId - Holon context
     * @returns {Promise<REAEvent[]>} All events
     */
    async getAll(holonId) {
        const events = await this.db.getAll(holonId.toString(), 'rea_events');
        return events || [];
    }

    /**
     * Query events with filters
     * @param {string} holonId - Holon context
     * @param {EventQueryFilters} filters - Query filters
     * @returns {Promise<REAEvent[]>} Matching events
     */
    async query(holonId, filters = {}) {
        const events = await this.getAll(holonId);

        return events.filter(event => {
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
     * Get events where agent is the provider
     * @param {string} holonId - Holon context
     * @param {string} agentId - Agent ID
     * @param {string} [resourceType] - Optional resource type filter
     * @returns {Promise<REAEvent[]>} Events where agent is provider
     */
    async getProviderEvents(holonId, agentId, resourceType = null) {
        const events = await this.query(holonId, { resourceType });
        return events.filter(e => String(e.provider?.id) === String(agentId));
    }

    /**
     * Get events where agent is the receiver
     * @param {string} holonId - Holon context
     * @param {string} agentId - Agent ID
     * @param {string} [resourceType] - Optional resource type filter
     * @returns {Promise<REAEvent[]>} Events where agent is receiver
     */
    async getReceiverEvents(holonId, agentId, resourceType = null) {
        const events = await this.query(holonId, { resourceType });
        return events.filter(e => String(e.receiver?.id) === String(agentId));
    }

    /**
     * Get events by event type
     * @param {string} holonId - Holon context
     * @param {string} eventType - Event type to filter by
     * @returns {Promise<REAEvent[]>} Matching events
     */
    async getByEventType(holonId, eventType) {
        return this.query(holonId, { eventType });
    }

    /**
     * Get events for a specific quest
     * @param {string} holonId - Holon context
     * @param {string} questId - Quest ID
     * @returns {Promise<REAEvent[]>} Events related to the quest
     */
    async getQuestEvents(holonId, questId) {
        const events = await this.getAll(holonId);
        return events.filter(e => e.context?.questId === questId);
    }

    /**
     * Get events for a specific item (library)
     * @param {string} holonId - Holon context
     * @param {string} itemId - Item ID
     * @returns {Promise<REAEvent[]>} Events related to the item
     */
    async getItemEvents(holonId, itemId) {
        const events = await this.getAll(holonId);
        return events.filter(e => e.context?.itemId === itemId || e.resource?.resourceId === itemId);
    }

    /**
     * Update an event's status
     * @param {string} holonId - Holon context
     * @param {string} eventId - Event ID
     * @param {string} status - New status
     * @returns {Promise<REAEvent|null>} Updated event or null
     */
    async updateStatus(holonId, eventId, status) {
        const event = await this.get(holonId, eventId);
        if (!event) return null;

        event.status = status;
        await this.put(holonId, event);
        return event;
    }

    /**
     * Count events matching filters
     * @param {string} holonId - Holon context
     * @param {EventQueryFilters} filters - Query filters
     * @returns {Promise<number>} Count of matching events
     */
    async count(holonId, filters = {}) {
        const events = await this.query(holonId, filters);
        return events.length;
    }

    /**
     * Sum resource quantities for matching events
     * @param {string} holonId - Holon context
     * @param {EventQueryFilters} filters - Query filters
     * @returns {Promise<number>} Sum of quantities
     */
    async sumQuantity(holonId, filters = {}) {
        const events = await this.query(holonId, filters);
        return events.reduce((sum, e) => sum + (e.resource?.quantity || 0), 0);
    }

    /**
     * Get events in a time range
     * @param {string} holonId - Holon context
     * @param {number} fromDate - Start timestamp
     * @param {number} toDate - End timestamp
     * @returns {Promise<REAEvent[]>} Events in range
     */
    async getInTimeRange(holonId, fromDate, toDate) {
        return this.query(holonId, { fromDate, toDate });
    }
}

export default REAEventStore;
