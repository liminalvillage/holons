/**
 * REA (Resource-Event-Agent) Accounting Types
 *
 * REA is an accounting ontology that models economic activity through:
 * - Resources: Things of economic value (time, money, items, reputation)
 * - Events: Observable occurrences that affect resources
 * - Agents: Participants in economic events (provider and receiver)
 *
 * Each event captures the duality of exchanges - resources flow FROM a provider TO a receiver.
 */

/**
 * Resource types that can be tracked in the system
 * @typedef {'time' | 'money' | 'appreciation' | 'credit' | 'item'} ResourceType
 */

/**
 * Agent types participating in events
 * @typedef {'user' | 'holon' | 'external'} AgentType
 */

/**
 * Event status
 * @typedef {'pending' | 'confirmed' | 'cancelled'} EventStatus
 */

/**
 * Event types for classification
 * @typedef {'quest:initiated' | 'quest:completed' | 'quest:time_logged' |
 *           'appreciation:sent' | 'appreciation:received' |
 *           'expense:paid' | 'expense:share' | 'transfer:direct' |
 *           'item:borrowed' | 'item:returned' | 'item:fee_paid' |
 *           'item:deposit_held' | 'item:deposit_returned' |
 *           'credit:issued' | 'credit:redeemed' | 'credit:transfer' |
 *           'offer:declared' | 'want:declared'} EventType
 */

/**
 * An economic agent (participant in events)
 * @typedef {Object} Agent
 * @property {string} id - Unique identifier (user ID, holon ID, or external reference)
 * @property {AgentType} type - Type of agent
 * @property {string} [name] - Display name
 */

/**
 * Resource specification within an event
 * @typedef {Object} Resource
 * @property {ResourceType} type - Type of resource
 * @property {number} quantity - Amount (positive for credits, can track direction via provider/receiver)
 * @property {string} unit - Unit of measure (hours, EUR, credits, item name, etc.)
 * @property {string} [resourceId] - For trackable items (library tools)
 */

/**
 * Context information for an event
 * @typedef {Object} EventContext
 * @property {string} holonId - Holon where event occurred
 * @property {string} [questId] - Related quest if applicable
 * @property {string} [expenseId] - Related expense if applicable
 * @property {string} [itemId] - Library item if applicable
 * @property {string} [note] - Description or reason
 * @property {boolean} [migrated] - True if event was created during migration
 */

/**
 * REA Event - the core accounting record
 * Each event captures a resource flow from provider to receiver
 *
 * @typedef {Object} REAEvent
 * @property {string} id - Unique event ID (format: holonId_timestamp_nonce)
 * @property {number} timestamp - Unix timestamp in milliseconds
 * @property {Resource} resource - What resource is being transferred
 * @property {Agent} provider - Who provides/gives the resource
 * @property {Agent} receiver - Who receives the resource
 * @property {EventContext} context - Contextual information
 * @property {EventType} eventType - Classification of the event
 * @property {EventStatus} status - Current status of the event
 */

/**
 * Query filters for retrieving events
 * @typedef {Object} EventQueryFilters
 * @property {ResourceType} [resourceType] - Filter by resource type
 * @property {EventType} [eventType] - Filter by event type
 * @property {string} [agentId] - Filter by agent (either provider or receiver)
 * @property {number} [fromDate] - Filter events after this timestamp
 * @property {number} [toDate] - Filter events before this timestamp
 * @property {EventStatus} [status] - Filter by status
 */

/**
 * User aggregates derived from REA events
 * @typedef {Object} UserAggregates
 * @property {number} initiated - Count of quests initiated
 * @property {number} completed - Count of quests completed
 * @property {number} sent - Count of appreciations sent
 * @property {number} received - Count of appreciations received
 * @property {number} hours - Total hours contributed
 * @property {number} collaboration - Collaboration score
 * @property {number} wants - Count of wants declared
 * @property {number} offers - Count of offers declared
 */

/**
 * Value equation weights for scoring
 * @typedef {Object} ValueEquation
 * @property {number} initiated - Weight for initiated tasks
 * @property {number} completed - Weight for completed tasks
 * @property {number} sent - Weight for appreciation sent
 * @property {number} received - Weight for appreciation received
 * @property {number} hours - Weight for hours contributed
 * @property {number} collaboration - Weight for collaboration
 * @property {number} wants - Weight for wants
 * @property {number} offers - Weight for offers
 * @property {Object.<string, number>} [currencies] - Currency-specific weights
 */

/**
 * Scored user result
 * @typedef {Object} ScoredUser
 * @property {Object} user - User profile object
 * @property {number} score - Calculated score
 * @property {UserAggregates} aggregates - Component aggregates
 */

// Export empty object for ES module compatibility
export default {};
