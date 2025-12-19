/**
 * REA Aggregator
 *
 * Derives aggregates, balances, scores, and reports from REA events.
 * All values are computed from the event stream - no mutable state.
 */

/**
 * @typedef {import('./types.js').REAEvent} REAEvent
 * @typedef {import('./types.js').UserAggregates} UserAggregates
 * @typedef {import('./types.js').ValueEquation} ValueEquation
 * @typedef {import('./types.js').ScoredUser} ScoredUser
 */

export class REAAggregator {
    /**
     * @param {import('./REAEventStore.js').REAEventStore} eventStore
     */
    constructor(eventStore) {
        this.eventStore = eventStore;
    }

    /**
     * Get user's aggregate statistics for scoring
     * @param {string} holonId - Holon context
     * @param {string} userId - User ID
     * @returns {Promise<UserAggregates>}
     */
    async getUserAggregates(holonId, userId) {
        const events = await this.eventStore.query(holonId, { agentId: userId });
        const userIdStr = String(userId);

        return {
            // Count events by type where user is provider
            initiated: events.filter(e =>
                e.eventType === 'quest:initiated' && String(e.provider?.id) === userIdStr
            ).length,

            completed: events.filter(e =>
                e.eventType === 'quest:completed' && String(e.provider?.id) === userIdStr
            ).length,

            sent: events.filter(e =>
                e.eventType === 'appreciation:sent' && String(e.provider?.id) === userIdStr
            ).length,

            received: events.filter(e =>
                e.eventType === 'appreciation:received' && String(e.receiver?.id) === userIdStr
            ).length,

            hours: events
                .filter(e => e.eventType === 'quest:time_logged' && String(e.provider?.id) === userIdStr)
                .reduce((sum, e) => sum + (e.resource?.quantity || 0), 0),

            collaboration: events
                .filter(e => e.eventType === 'quest:time_logged' && String(e.provider?.id) === userIdStr)
                .length,

            wants: events.filter(e =>
                e.eventType === 'want:declared' && String(e.provider?.id) === userIdStr
            ).length,

            offers: events.filter(e =>
                e.eventType === 'offer:declared' && String(e.provider?.id) === userIdStr
            ).length
        };
    }

    /**
     * Get currency balance for a user (positive = owed to user, negative = user owes)
     * @param {string} holonId - Holon context
     * @param {string} userId - User ID
     * @param {string} currency - Currency code
     * @returns {Promise<number>}
     */
    async getCurrencyBalance(holonId, userId, currency) {
        const events = await this.eventStore.query(holonId, { resourceType: 'money' });
        const currencyLower = currency.toLowerCase();
        const userIdStr = String(userId);

        const currencyEvents = events.filter(e =>
            e.resource?.unit?.toLowerCase() === currencyLower
        );

        let balance = 0;

        currencyEvents.forEach(e => {
            const providerId = String(e.provider?.id);
            const receiverId = String(e.receiver?.id);

            if (e.eventType === 'expense:share') {
                // Provider is owed, receiver owes
                if (providerId === userIdStr) {
                    balance += e.resource.quantity;
                }
                if (receiverId === userIdStr) {
                    balance -= e.resource.quantity;
                }
            } else if (e.eventType === 'expense:paid') {
                // Payer spent money (tracked separately for reference)
                // This affects total expenditure but not inter-user balance
            } else if (e.eventType === 'transfer:direct') {
                // Direct transfers affect balance
                if (providerId === userIdStr) {
                    balance -= e.resource.quantity;
                }
                if (receiverId === userIdStr) {
                    balance += e.resource.quantity;
                }
            }
        });

        return balance;
    }

    /**
     * Get credit balance for library system
     * @param {string} holonId - Holon context
     * @param {string} userId - User ID
     * @param {number} [startingCredits=10] - Initial credits for new users
     * @returns {Promise<number>}
     */
    async getCreditBalance(holonId, userId, startingCredits = 10) {
        const events = await this.eventStore.query(holonId, { resourceType: 'credit' });
        const userIdStr = String(userId);

        let balance = startingCredits;

        events.forEach(e => {
            const providerId = String(e.provider?.id);
            const receiverId = String(e.receiver?.id);

            if (receiverId === userIdStr) {
                balance += e.resource?.quantity || 0;
            }
            if (providerId === userIdStr) {
                balance -= e.resource?.quantity || 0;
            }
        });

        return balance;
    }

    /**
     * Build credit matrix for expense settlement
     * Returns N×N matrix where [i][j] = amount user i is owed by user j
     * @param {string} holonId - Holon context
     * @param {string} currency - Currency code
     * @param {Object[]} users - Array of user objects with id property
     * @returns {Promise<number[][]>}
     */
    async buildCreditMatrix(holonId, currency, users) {
        const n = users.length;
        const matrix = Array(n).fill(null).map(() => Array(n).fill(0));
        const currencyLower = currency.toLowerCase();

        const events = await this.eventStore.query(holonId, {
            resourceType: 'money',
            eventType: 'expense:share'
        });

        const currencyEvents = events.filter(e =>
            e.resource?.unit?.toLowerCase() === currencyLower
        );

        currencyEvents.forEach(e => {
            const providerIdx = users.findIndex(u => String(u.id) === String(e.provider?.id));
            const receiverIdx = users.findIndex(u => String(u.id) === String(e.receiver?.id));

            if (providerIdx !== -1 && receiverIdx !== -1 && providerIdx !== receiverIdx) {
                // Provider is owed by receiver
                matrix[providerIdx][receiverIdx] += e.resource.quantity;
            }
        });

        return matrix;
    }

    /**
     * Get net balances for all users in a currency
     * @param {string} holonId - Holon context
     * @param {string} currency - Currency code
     * @param {Object[]} users - Array of user objects
     * @returns {Promise<Object[]>} Array of {user, balance} objects
     */
    async getNetBalances(holonId, currency, users) {
        const balances = await Promise.all(
            users.map(async user => ({
                user,
                balance: await this.getCurrencyBalance(holonId, user.id, currency)
            }))
        );

        return balances.sort((a, b) => b.balance - a.balance);
    }

    /**
     * Calculate user score based on value equation
     * @param {string} holonId - Holon context
     * @param {string} userId - User ID
     * @param {ValueEquation} equation - Weights for each metric
     * @returns {Promise<number>}
     */
    async calculateUserScore(holonId, userId, equation) {
        const aggregates = await this.getUserAggregates(holonId, userId);

        let score = 0;
        if (equation.initiated) score += aggregates.initiated * equation.initiated;
        if (equation.completed) score += aggregates.completed * equation.completed;
        if (equation.sent) score += aggregates.sent * equation.sent;
        if (equation.received) score += aggregates.received * equation.received;
        if (equation.hours) score += aggregates.hours * equation.hours;
        if (equation.collaboration) score += aggregates.collaboration * equation.collaboration;
        if (equation.wants) score += aggregates.wants * equation.wants;
        if (equation.offers) score += aggregates.offers * equation.offers;

        // Add currency weights
        if (equation.currencies) {
            for (const [currency, weight] of Object.entries(equation.currencies)) {
                if (weight > 0) {
                    const balance = await this.getCurrencyBalance(holonId, userId, currency);
                    score += balance * weight;
                }
            }
        }

        return score;
    }

    /**
     * Get all user scores for a holon
     * @param {string} holonId - Holon context
     * @param {Object[]} users - Array of user objects
     * @param {ValueEquation} equation - Value equation weights
     * @returns {Promise<ScoredUser[]>}
     */
    async getAllUserScores(holonId, users, equation) {
        const scores = await Promise.all(
            users.map(async user => {
                const aggregates = await this.getUserAggregates(holonId, user.id);
                const score = await this.calculateUserScore(holonId, user.id, equation);
                return { user, score, aggregates };
            })
        );

        return scores.sort((a, b) => b.score - a.score);
    }

    /**
     * Get total hours logged for a holon
     * @param {string} holonId - Holon context
     * @returns {Promise<number>}
     */
    async getTotalHours(holonId) {
        return this.eventStore.sumQuantity(holonId, {
            eventType: 'quest:time_logged'
        });
    }

    /**
     * Get total expenses for a holon in a currency
     * @param {string} holonId - Holon context
     * @param {string} currency - Currency code
     * @returns {Promise<number>}
     */
    async getTotalExpenses(holonId, currency) {
        const events = await this.eventStore.query(holonId, {
            eventType: 'expense:paid'
        });

        const currencyLower = currency.toLowerCase();
        return events
            .filter(e => e.resource?.unit?.toLowerCase() === currencyLower)
            .reduce((sum, e) => sum + (e.resource?.quantity || 0), 0);
    }

    /**
     * Get activity summary for a time period
     * @param {string} holonId - Holon context
     * @param {number} fromDate - Start timestamp
     * @param {number} toDate - End timestamp
     * @returns {Promise<Object>}
     */
    async getActivitySummary(holonId, fromDate, toDate) {
        const events = await this.eventStore.getInTimeRange(holonId, fromDate, toDate);

        return {
            totalEvents: events.length,
            questsInitiated: events.filter(e => e.eventType === 'quest:initiated').length,
            questsCompleted: events.filter(e => e.eventType === 'quest:completed').length,
            hoursLogged: events
                .filter(e => e.eventType === 'quest:time_logged')
                .reduce((sum, e) => sum + (e.resource?.quantity || 0), 0),
            appreciationsSent: events.filter(e => e.eventType === 'appreciation:sent').length,
            expensesPaid: events
                .filter(e => e.eventType === 'expense:paid')
                .reduce((sum, e) => sum + (e.resource?.quantity || 0), 0),
            itemsBorrowed: events.filter(e => e.eventType === 'item:borrowed').length,
            itemsReturned: events.filter(e => e.eventType === 'item:returned').length
        };
    }

    /**
     * Get user activity history
     * @param {string} holonId - Holon context
     * @param {string} userId - User ID
     * @param {number} [limit] - Optional limit
     * @returns {Promise<REAEvent[]>}
     */
    async getUserActivityHistory(holonId, userId, limit = null) {
        const events = await this.eventStore.query(holonId, { agentId: userId });
        const sorted = events.sort((a, b) => b.timestamp - a.timestamp);
        return limit ? sorted.slice(0, limit) : sorted;
    }

    /**
     * Get item lending history
     * @param {string} holonId - Holon context
     * @param {string} itemId - Library item ID
     * @returns {Promise<Object[]>}
     */
    async getItemLendingHistory(holonId, itemId) {
        const events = await this.eventStore.getItemEvents(holonId, itemId);
        return events
            .filter(e => e.eventType === 'item:borrowed' || e.eventType === 'item:returned')
            .sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * Get pending deposits (items not yet returned)
     * @param {string} holonId - Holon context
     * @returns {Promise<REAEvent[]>}
     */
    async getPendingDeposits(holonId) {
        const events = await this.eventStore.query(holonId, {
            eventType: 'item:deposit_held',
            status: 'pending'
        });
        return events;
    }
}

export default REAAggregator;
