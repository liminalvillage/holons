/**
 * Federation handshake protocol for HoloSphere.
 *
 * Payloads are JSON with `type: federation_request | federation_response |
 * federation_update | federation_update_response`, carried as NIP-17 private
 * DMs (nostr-dm.js): encrypted, sender-hidden, readable by any Nostr client
 * holding the recipient key. The sphere must have relays and the caller must
 * pass its private key; without either, sends fail and subscriptions are
 * inert (with a warning).
 */
import { sendDirectMessage, subscribeDirectMessages } from './nostr-dm.js';

/**
 * Generate a unique message ID
 */
function generateMessageId() {
    return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

/**
 * Send a handshake message to a recipient over NIP-17.
 */
async function sendDM(holosphere, recipientPubKey, message, privateKey = null) {
    const msgId = generateMessageId();
    const payload = JSON.stringify({
        ...message,
        id: msgId,
        timestamp: Date.now()
    });

    if (!privateKey) {
        console.warn('[handshake] cannot send: no private key');
        return { success: false, error: 'no private key' };
    }
    if (!holosphere?.nostrRelays?.().length) {
        console.warn('[handshake] cannot send: no relays configured');
        return { success: false, error: 'no relays' };
    }
    try {
        await sendDirectMessage(holosphere, { privateKey, recipientPubkey: recipientPubKey, content: payload, subject: message.type });
        return { success: true, id: msgId };
    } catch (e) {
        console.warn('[handshake] NIP-17 send failed:', e?.message);
        return { success: false, error: e?.message || 'send failed' };
    }
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
    let active = true;
    const processedMessages = new Set();

    const dispatch = (message, senderPubKey) => {
        switch (message.type) {
            case 'federation_request':
                if (handlers.onRequest) handlers.onRequest(message, senderPubKey);
                break;
            case 'federation_response':
                if (handlers.onResponse) handlers.onResponse(message, senderPubKey);
                break;
            case 'federation_update':
                if (handlers.onUpdate) handlers.onUpdate(message, senderPubKey);
                break;
            case 'federation_update_response':
                if (handlers.onUpdateResponse) handlers.onUpdateResponse(message, senderPubKey);
                break;
            default:
                console.log('[handshake] Unknown DM type:', message.type);
        }
    };

    // The SEALED sender is authoritative, not the payload's claim.
    let closeNostr = () => {};
    if (!privateKey) {
        console.warn('[handshake] subscribeToFederationDMs: no private key — nothing to listen with');
    } else {
        try {
            closeNostr = subscribeDirectMessages(holosphere, privateKey, ({ content, sender }) => {
                if (!active) return;
                try {
                    const message = JSON.parse(content);
                    if (!message || typeof message !== 'object' || !message.type) return;
                    if (message.id && processedMessages.has(message.id)) return;
                    if (message.id) processedMessages.add(message.id);
                    dispatch({ ...message, senderPubKey: sender }, sender);
                } catch { /* not a handshake payload */ }
            });
        } catch (e) {
            console.warn('[handshake] NIP-17 subscribe failed:', e?.message);
        }
    }

    return () => {
        active = false;
        closeNostr();
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

    const result = await sendDM(holosphere, partnerPubKey, request, privateKey);
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

    return sendDM(holosphere, requesterPubKey, response, privateKey);
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

    return sendDM(holosphere, requesterPubKey, response, privateKey);
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

    return sendDM(holosphere, partnerPubKey, update, privateKey);
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

    return sendDM(holosphere, requesterPubKey, response, privateKey);
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

    return sendDM(holosphere, requesterPubKey, response, privateKey);
}
