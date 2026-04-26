/**
 * GunDB-based federation handshake protocol for HoloSphere v1.3
 * Replaces Nostr NIP-44 encrypted DMs with GunDB DM channels.
 * Same protocol payloads (JSON with type: federation_request/response/update),
 * different transport layer.
 */

/**
 * Generate a unique message ID
 */
function generateMessageId() {
    return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

/**
 * Get the DM path for a recipient in GunDB
 */
function getDMPath(holosphere, recipientPubKey) {
    return holosphere.gun.get(holosphere.appname).get('_dm').get(recipientPubKey);
}

/**
 * Write a DM to a recipient's channel
 */
async function sendDM(holosphere, recipientPubKey, message) {
    const msgId = generateMessageId();
    const payload = JSON.stringify({
        ...message,
        id: msgId,
        timestamp: Date.now()
    });

    return new Promise((resolve) => {
        getDMPath(holosphere, recipientPubKey).get(msgId).put(payload, (ack) => {
            if (ack.err) {
                console.warn('[handshake] Failed to send DM:', ack.err);
                resolve({ success: false, error: ack.err });
            } else {
                resolve({ success: true, id: msgId });
            }
        });
    });
}

/**
 * Subscribe to federation DMs for a public key.
 * Listens for incoming federation requests, responses, and updates.
 *
 * @param {object} holosphere - The HoloSphere instance
 * @param {string|Uint8Array} privateKey - The user's private key (for identity)
 * @param {string} publicKey - The user's public key
 * @param {object} handlers - Event handlers
 * @param {function} handlers.onRequest - Called when a federation request is received
 * @param {function} handlers.onResponse - Called when a federation response is received
 * @param {function} handlers.onUpdate - Called when a federation update is received
 * @param {function} handlers.onUpdateResponse - Called when an update response is received
 * @returns {function} Unsubscribe function
 */
export function subscribeToFederationDMs(holosphere, privateKey, publicKey, handlers) {
    const dmPath = getDMPath(holosphere, publicKey);
    let active = true;
    const processedMessages = new Set();

    dmPath.map().on((data, key) => {
        if (!active || !data || key === '_') return;

        // Avoid processing the same message twice
        if (processedMessages.has(key)) return;
        processedMessages.add(key);

        try {
            const message = typeof data === 'string' ? JSON.parse(data) : data;
            const senderPubKey = message.senderPubKey || message.sender || '';

            switch (message.type) {
                case 'federation_request':
                    if (handlers.onRequest) {
                        handlers.onRequest(message, senderPubKey);
                    }
                    break;
                case 'federation_response':
                    if (handlers.onResponse) {
                        handlers.onResponse(message, senderPubKey);
                    }
                    break;
                case 'federation_update':
                    if (handlers.onUpdate) {
                        handlers.onUpdate(message, senderPubKey);
                    }
                    break;
                case 'federation_update_response':
                    if (handlers.onUpdateResponse) {
                        handlers.onUpdateResponse(message, senderPubKey);
                    }
                    break;
                default:
                    console.log('[handshake] Unknown DM type:', message.type);
            }
        } catch (e) {
            // Skip unparseable messages
        }
    });

    // Return unsubscribe function
    return () => {
        active = false;
        dmPath.off();
    };
}

/**
 * Initiate a federation handshake with a partner.
 *
 * @param {object} holosphere - The HoloSphere instance
 * @param {string|Uint8Array} privateKey - The initiator's private key
 * @param {object} params - Handshake parameters
 * @param {string} params.partnerPubKey - The partner's public key
 * @param {string} params.holonId - The initiator's holon ID
 * @param {string} params.holonName - The initiator's holon name
 * @param {object} [params.lensConfig] - Lens configuration to share
 * @param {string} [params.message] - Optional message
 * @returns {Promise<{ success: boolean, requestId?: string }>}
 */
export async function initiateFederationHandshake(holosphere, privateKey, params) {
    const {
        partnerPubKey,
        holonId,
        holonName,
        lensConfig = {},
        message = ''
    } = params;

    const senderPubKey = holosphere.client?.publicKey || '';

    const request = {
        type: 'federation_request',
        senderPubKey,
        senderHolonId: holonId,
        senderHolonName: holonName,
        lensConfig,
        message,
        status: 'pending'
    };

    const result = await sendDM(holosphere, partnerPubKey, request);
    if (result.success) {
        console.log('[handshake] Federation request sent to:', partnerPubKey?.slice(0, 8));
    }
    return { success: result.success, requestId: result.id };
}

/**
 * Accept a federation request.
 *
 * @param {object} holosphere - The HoloSphere instance
 * @param {string|Uint8Array} privateKey - The responder's private key
 * @param {object} params - Accept parameters
 * @param {string} params.requesterPubKey - The requester's public key
 * @param {string} params.holonId - The responder's holon ID
 * @param {string} params.holonName - The responder's holon name
 * @param {object} [params.lensConfig] - Lens configuration
 * @param {string} [params.requestId] - Original request ID
 * @returns {Promise<{ success: boolean }>}
 */
export async function acceptFederationRequest(holosphere, privateKey, params) {
    const {
        requesterPubKey,
        holonId,
        holonName,
        lensConfig = {},
        requestId
    } = params;

    const senderPubKey = holosphere.client?.publicKey || '';

    const response = {
        type: 'federation_response',
        senderPubKey,
        responderHolonId: holonId,
        responderHolonName: holonName,
        lensConfig,
        status: 'accepted',
        requestId
    };

    // Add the requester as an allowed author
    if (requesterPubKey) {
        holosphere.addAllowedAuthor(requesterPubKey);
    }

    return sendDM(holosphere, requesterPubKey, response);
}

/**
 * Reject a federation request.
 */
export async function rejectFederationRequest(holosphere, privateKey, params) {
    const { requesterPubKey, holonId, reason = '', requestId } = params;
    const senderPubKey = holosphere.client?.publicKey || '';

    const response = {
        type: 'federation_response',
        senderPubKey,
        responderHolonId: holonId,
        status: 'rejected',
        reason,
        requestId
    };

    return sendDM(holosphere, requesterPubKey, response);
}

/**
 * Process a received federation response.
 * Creates the federation relationship on the initiator's side.
 *
 * @param {object} holosphere - The HoloSphere instance
 * @param {object} response - The response object
 * @param {string} senderPubKey - The responder's public key
 * @param {object} options - Processing options
 * @param {string} options.holonId - The initiator's holon ID
 * @param {string[]} [options.inboundLenses] - Lenses to accept inbound data for
 * @returns {Promise<{ success: boolean }>}
 */
export async function processFederationResponse(holosphere, response, senderPubKey, options = {}) {
    const { holonId, inboundLenses = [] } = options;

    if (response.status !== 'accepted') {
        return { success: false, reason: 'not_accepted' };
    }

    try {
        // Add the responder as an allowed author
        if (senderPubKey) {
            holosphere.addAllowedAuthor(senderPubKey);
        }

        // Store the responder's holon ID for federation lookup
        const responderHolonId = response.responderHolonId || senderPubKey;

        console.log('[handshake] Processing accepted federation from:', responderHolonId?.slice(0, 8));
        return { success: true, responderHolonId };
    } catch (error) {
        console.error('[handshake] Error processing federation response:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Request a federation update (e.g., change shared lenses).
 *
 * @param {object} holosphere - The HoloSphere instance
 * @param {string|Uint8Array} privateKey - The requester's private key
 * @param {object} params - Update parameters
 * @param {string} params.partnerPubKey - The partner's public key
 * @param {string} params.holonId - The requester's holon ID
 * @param {string} params.holonName - The requester's holon name
 * @param {object} params.newLensConfig - The new lens configuration
 * @param {string} [params.message] - Optional message
 * @returns {Promise<{ success: boolean }>}
 */
export async function requestFederationUpdate(holosphere, privateKey, params) {
    const {
        partnerPubKey,
        holonId,
        holonName,
        newLensConfig = {},
        message = ''
    } = params;

    const senderPubKey = holosphere.client?.publicKey || '';

    const update = {
        type: 'federation_update',
        senderPubKey,
        senderHolonId: holonId,
        senderHolonName: holonName,
        newLensConfig,
        message
    };

    return sendDM(holosphere, partnerPubKey, update);
}

/**
 * Accept a federation update request.
 */
export async function acceptFederationUpdate(holosphere, privateKey, params) {
    const { requesterPubKey, holonId, newLensConfig = {}, updateId } = params;
    const senderPubKey = holosphere.client?.publicKey || '';

    const response = {
        type: 'federation_update_response',
        senderPubKey,
        responderHolonId: holonId,
        status: 'accepted',
        newLensConfig,
        updateId
    };

    return sendDM(holosphere, requesterPubKey, response);
}

/**
 * Reject a federation update request.
 */
export async function rejectFederationUpdate(holosphere, privateKey, params) {
    const { requesterPubKey, holonId, reason = '', updateId } = params;
    const senderPubKey = holosphere.client?.publicKey || '';

    const response = {
        type: 'federation_update_response',
        senderPubKey,
        responderHolonId: holonId,
        status: 'rejected',
        reason,
        updateId
    };

    return sendDM(holosphere, requesterPubKey, response);
}
