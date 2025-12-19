/**
 * REA Event Factory
 *
 * Factory for creating properly structured REA (Resource-Event-Agent) events.
 * Ensures consistent event structure and proper dual-agent recording.
 */

/**
 * @typedef {import('./types.js').REAEvent} REAEvent
 * @typedef {import('./types.js').Agent} Agent
 */

export class REAEventFactory {
    /**
     * Generate a unique event ID
     * @param {string} holonId - Holon context
     * @returns {string} Unique event ID
     */
    static generateId(holonId) {
        const timestamp = Date.now();
        const nonce = Math.random().toString(36).substring(2, 9);
        return `${holonId}_${timestamp}_${nonce}`;
    }

    /**
     * Create an Agent object from user data
     * @param {Object} user - User object with id, username, first_name
     * @returns {Agent}
     */
    static createUserAgent(user) {
        return {
            id: String(user.id),
            type: 'user',
            name: user.username || user.first_name || String(user.id)
        };
    }

    /**
     * Create a holon Agent
     * @param {string} holonId - Holon ID
     * @param {string} [name] - Optional holon name
     * @returns {Agent}
     */
    static createHolonAgent(holonId, name = null) {
        return {
            id: String(holonId),
            type: 'holon',
            name: name || String(holonId)
        };
    }

    /**
     * Create an external Agent (for expenses to external vendors)
     * @param {string} description - Description of external entity
     * @returns {Agent}
     */
    static createExternalAgent(description) {
        return {
            id: 'external',
            type: 'external',
            name: description
        };
    }

    // ==================== Quest Events ====================

    /**
     * Create quest initiated event
     * @param {string} holonId - Holon context
     * @param {Object} initiator - User who initiated the quest
     * @param {Object} quest - Quest object with id and title
     * @returns {REAEvent}
     */
    static questInitiated(holonId, initiator, quest) {
        return {
            id: this.generateId(holonId),
            timestamp: Date.now(),
            resource: {
                type: 'appreciation',
                quantity: 1,
                unit: 'initiative'
            },
            provider: this.createUserAgent(initiator),
            receiver: this.createHolonAgent(holonId),
            context: {
                holonId: String(holonId),
                questId: String(quest.id),
                note: quest.title
            },
            eventType: 'quest:initiated',
            status: 'confirmed'
        };
    }

    /**
     * Create quest completed event
     * @param {string} holonId - Holon context
     * @param {Object} participant - User who completed the quest
     * @param {Object} quest - Quest object with id and title
     * @returns {REAEvent}
     */
    static questCompleted(holonId, participant, quest) {
        return {
            id: this.generateId(holonId),
            timestamp: Date.now(),
            resource: {
                type: 'appreciation',
                quantity: 1,
                unit: 'completion'
            },
            provider: this.createUserAgent(participant),
            receiver: this.createHolonAgent(holonId),
            context: {
                holonId: String(holonId),
                questId: String(quest.id),
                note: quest.title
            },
            eventType: 'quest:completed',
            status: 'confirmed'
        };
    }

    /**
     * Create time logged event
     * @param {string} holonId - Holon context
     * @param {Object} user - User who logged time
     * @param {number} hours - Hours worked
     * @param {string} [questId] - Optional quest ID
     * @param {string} [note] - Optional description
     * @returns {REAEvent}
     */
    static timeLogged(holonId, user, hours, questId = null, note = null) {
        return {
            id: this.generateId(holonId),
            timestamp: Date.now(),
            resource: {
                type: 'time',
                quantity: hours,
                unit: 'hours'
            },
            provider: this.createUserAgent(user),
            receiver: this.createHolonAgent(holonId),
            context: {
                holonId: String(holonId),
                questId: questId ? String(questId) : null,
                note
            },
            eventType: 'quest:time_logged',
            status: 'confirmed'
        };
    }

    // ==================== Appreciation Events ====================

    /**
     * Create appreciation exchange events (dual-event pattern)
     * Returns two events: one for sent, one for received
     * @param {string} holonId - Holon context
     * @param {Object} sender - User sending appreciation
     * @param {Object} receiver - User receiving appreciation
     * @param {number} amount - Amount of appreciation
     * @param {string} reason - Reason for appreciation
     * @param {string} [questId] - Optional related quest
     * @returns {REAEvent[]} Array of two events (sent and received)
     */
    static appreciationExchange(holonId, sender, receiver, amount, reason, questId = null) {
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
                    unit: 'kudos'
                },
                provider: senderAgent,
                receiver: receiverAgent,
                context: {
                    holonId: String(holonId),
                    questId: questId ? String(questId) : null,
                    note: reason
                },
                eventType: 'appreciation:sent',
                status: 'confirmed'
            },
            // Received event (from receiver's perspective)
            {
                id: `${baseId}_received`,
                timestamp,
                resource: {
                    type: 'appreciation',
                    quantity: amount,
                    unit: 'kudos'
                },
                provider: senderAgent,
                receiver: receiverAgent,
                context: {
                    holonId: String(holonId),
                    questId: questId ? String(questId) : null,
                    note: reason
                },
                eventType: 'appreciation:received',
                status: 'confirmed'
            }
        ];
    }

    // ==================== Expense Events ====================

    /**
     * Create expense events (payer + shares for each participant)
     * @param {string} holonId - Holon context
     * @param {Object} expense - Expense object
     * @param {number} expense.id - Expense ID
     * @param {number} expense.amount - Total amount
     * @param {string} expense.currency - Currency code
     * @param {string} expense.description - Description
     * @param {string|number} expense.paidBy - ID of user who paid
     * @param {Array<string|number>} expense.splitWith - IDs of users sharing
     * @param {number} [expense.date] - Timestamp of expense
     * @returns {REAEvent[]} Array of expense events
     */
    static expenseEvents(holonId, expense) {
        const events = [];
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
                unit: expense.currency.toLowerCase()
            },
            provider: { id: String(expense.paidBy), type: 'user' },
            receiver: this.createExternalAgent(expense.description),
            context: {
                holonId: String(holonId),
                expenseId: String(expense.id),
                note: expense.description
            },
            eventType: 'expense:paid',
            status: 'confirmed'
        });

        // Share events - each participant's share (creates debt to payer)
        expense.splitWith.forEach((userId, index) => {
            if (String(userId) !== String(expense.paidBy)) {
                events.push({
                    id: `${baseId}_share_${index}`,
                    timestamp,
                    resource: {
                        type: 'money',
                        quantity: shareAmount,
                        unit: expense.currency.toLowerCase()
                    },
                    provider: { id: String(expense.paidBy), type: 'user' },
                    receiver: { id: String(userId), type: 'user' },
                    context: {
                        holonId: String(holonId),
                        expenseId: String(expense.id),
                        note: expense.description
                    },
                    eventType: 'expense:share',
                    status: 'confirmed'
                });
            }
        });

        return events;
    }

    /**
     * Create direct transfer event
     * @param {string} holonId - Holon context
     * @param {Object} sender - User sending
     * @param {Object} receiver - User receiving
     * @param {number} amount - Amount
     * @param {string} currency - Currency
     * @param {string} [note] - Optional description
     * @returns {REAEvent}
     */
    static directTransfer(holonId, sender, receiver, amount, currency, note = null) {
        return {
            id: this.generateId(holonId),
            timestamp: Date.now(),
            resource: {
                type: 'money',
                quantity: amount,
                unit: currency.toLowerCase()
            },
            provider: this.createUserAgent(sender),
            receiver: this.createUserAgent(receiver),
            context: {
                holonId: String(holonId),
                note
            },
            eventType: 'transfer:direct',
            status: 'confirmed'
        };
    }

    // ==================== Library/Item Events ====================

    /**
     * Create item borrowed events
     * @param {string} holonId - Holon context
     * @param {Object} borrower - User borrowing
     * @param {Object} item - Library item with id, owner, credits
     * @param {number} credits - Credits for borrowing
     * @param {number} deposit - Deposit amount
     * @returns {REAEvent[]} Array of borrow-related events
     */
    static itemBorrowed(holonId, borrower, item, credits, deposit) {
        const baseId = this.generateId(holonId);
        const timestamp = Date.now();
        const events = [];

        // Item borrowed event
        events.push({
            id: `${baseId}_borrow`,
            timestamp,
            resource: {
                type: 'item',
                quantity: 1,
                unit: item.id,
                resourceId: item.id
            },
            provider: { id: String(item.owner), type: 'user' },
            receiver: this.createUserAgent(borrower),
            context: {
                holonId: String(holonId),
                itemId: item.id
            },
            eventType: 'item:borrowed',
            status: 'confirmed'
        });

        // Credits paid to owner
        if (credits > 0) {
            events.push({
                id: `${baseId}_fee`,
                timestamp,
                resource: {
                    type: 'credit',
                    quantity: credits,
                    unit: 'credits'
                },
                provider: this.createUserAgent(borrower),
                receiver: { id: String(item.owner), type: 'user' },
                context: {
                    holonId: String(holonId),
                    itemId: item.id
                },
                eventType: 'item:fee_paid',
                status: 'confirmed'
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
                    unit: 'credits'
                },
                provider: this.createUserAgent(borrower),
                receiver: this.createHolonAgent(holonId),
                context: {
                    holonId: String(holonId),
                    itemId: item.id
                },
                eventType: 'item:deposit_held',
                status: 'pending'
            });
        }

        return events;
    }

    /**
     * Create item returned events
     * @param {string} holonId - Holon context
     * @param {Object} borrower - User returning
     * @param {Object} item - Library item
     * @param {number} depositAmount - Deposit to return
     * @returns {REAEvent[]} Array of return-related events
     */
    static itemReturned(holonId, borrower, item, depositAmount) {
        const baseId = this.generateId(holonId);
        const timestamp = Date.now();
        const events = [];

        // Item returned event
        events.push({
            id: `${baseId}_return`,
            timestamp,
            resource: {
                type: 'item',
                quantity: 1,
                unit: item.id,
                resourceId: item.id
            },
            provider: this.createUserAgent(borrower),
            receiver: { id: String(item.owner), type: 'user' },
            context: {
                holonId: String(holonId),
                itemId: item.id
            },
            eventType: 'item:returned',
            status: 'confirmed'
        });

        // Deposit returned
        if (depositAmount > 0) {
            events.push({
                id: `${baseId}_deposit_return`,
                timestamp,
                resource: {
                    type: 'credit',
                    quantity: depositAmount,
                    unit: 'credits'
                },
                provider: this.createHolonAgent(holonId),
                receiver: this.createUserAgent(borrower),
                context: {
                    holonId: String(holonId),
                    itemId: item.id
                },
                eventType: 'item:deposit_returned',
                status: 'confirmed'
            });
        }

        return events;
    }

    // ==================== Offer/Want Events ====================

    /**
     * Create offer declared event
     * @param {string} holonId - Holon context
     * @param {Object} user - User making offer
     * @param {string} offer - What is offered
     * @returns {REAEvent}
     */
    static offerDeclared(holonId, user, offer) {
        return {
            id: this.generateId(holonId),
            timestamp: Date.now(),
            resource: {
                type: 'appreciation',
                quantity: 1,
                unit: 'offer'
            },
            provider: this.createUserAgent(user),
            receiver: this.createHolonAgent(holonId),
            context: {
                holonId: String(holonId),
                note: offer
            },
            eventType: 'offer:declared',
            status: 'confirmed'
        };
    }

    /**
     * Create want declared event
     * @param {string} holonId - Holon context
     * @param {Object} user - User declaring want
     * @param {string} want - What is wanted
     * @returns {REAEvent}
     */
    static wantDeclared(holonId, user, want) {
        return {
            id: this.generateId(holonId),
            timestamp: Date.now(),
            resource: {
                type: 'appreciation',
                quantity: 1,
                unit: 'want'
            },
            provider: this.createUserAgent(user),
            receiver: this.createHolonAgent(holonId),
            context: {
                holonId: String(holonId),
                note: want
            },
            eventType: 'want:declared',
            status: 'confirmed'
        };
    }

    // ==================== Credit Events ====================

    /**
     * Create credit issued event (for mutual credit systems)
     * @param {string} holonId - Holon context
     * @param {Object} issuer - User/holon issuing credits
     * @param {Object} recipient - User receiving credits
     * @param {number} amount - Amount of credits
     * @param {string} [note] - Optional reason
     * @returns {REAEvent}
     */
    static creditIssued(holonId, issuer, recipient, amount, note = null) {
        return {
            id: this.generateId(holonId),
            timestamp: Date.now(),
            resource: {
                type: 'credit',
                quantity: amount,
                unit: 'credits'
            },
            provider: this.createUserAgent(issuer),
            receiver: this.createUserAgent(recipient),
            context: {
                holonId: String(holonId),
                note
            },
            eventType: 'credit:issued',
            status: 'confirmed'
        };
    }

    /**
     * Create credit transfer event
     * @param {string} holonId - Holon context
     * @param {Object} sender - User sending credits
     * @param {Object} recipient - User receiving credits
     * @param {number} amount - Amount of credits
     * @param {string} [note] - Optional reason
     * @returns {REAEvent}
     */
    static creditTransfer(holonId, sender, recipient, amount, note = null) {
        return {
            id: this.generateId(holonId),
            timestamp: Date.now(),
            resource: {
                type: 'credit',
                quantity: amount,
                unit: 'credits'
            },
            provider: this.createUserAgent(sender),
            receiver: this.createUserAgent(recipient),
            context: {
                holonId: String(holonId),
                note
            },
            eventType: 'credit:transfer',
            status: 'confirmed'
        };
    }
}

export default REAEventFactory;
