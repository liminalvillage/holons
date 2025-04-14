// holo_utils.js
import * as h3 from 'h3-js';

/**
 * Converts latitude and longitude to a holon identifier.
 * @param {number} lat - The latitude.
 * @param {number} lng - The longitude.
 * @param {number} resolution - The resolution level.
 * @returns {Promise<string>} - The resulting holon identifier.
 */
export async function getHolon(lat, lng, resolution) { // Doesn't need holoInstance
    return h3.latLngToCell(lat, lng, resolution);
}

/**
 * Retrieves all containing holonagons at all scales for given coordinates.
 * @param {number} lat - The latitude.
 * @param {number} lng - The longitude.
 * @returns {Array<string>} - List of holon identifiers.
 */
export function getScalespace(lat, lng) { // Doesn't need holoInstance
    let list = []
    let cell = h3.latLngToCell(lat, lng, 14);
    list.push(cell)
    for (let i = 13; i >= 0; i--) {
        list.push(h3.cellToParent(cell, i))
    }
    return list
}

/**
 * Retrieves all containing holonagons at all scales for a given holon.
 * @param {string} holon - The holon identifier.
 * @returns {Array<string>} - List of holon identifiers.
 */
export function getHolonScalespace(holon) { // Doesn't need holoInstance
    let list = []
    let res = h3.getResolution(holon)
    for (let i = res; i >= 0; i--) {
        list.push(h3.cellToParent(holon, i))
    }
    return list
}

/**
 * Subscribes to changes in a specific holon and lens.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - The holon identifier.
 * @param {string} lens - The lens to subscribe to.
 * @param {function} callback - The callback to execute on changes.
 * @returns {Promise<object>} - Subscription object with unsubscribe method
 */
export async function subscribe(holoInstance, holon, lens, callback) {
    if (!holon || !lens) {
        throw new Error('subscribe: Missing holon or lens parameters:', holon, lens);
    }

    if (!callback || typeof callback !== 'function') {
        throw new Error('subscribe: Callback must be a function');
    }

    const subscriptionId = holoInstance.generateId(); // Use instance's generateId

    try {
        // Create the subscription
        const gunSubscription = holoInstance.gun.get(holoInstance.appname).get(holon).get(lens).map().on(async (data, key) => {
            // Check if subscription is still active before processing
            if (!holoInstance.subscriptions[subscriptionId]?.active) {
                return;
            }

            if (data) {
                try {
                    let parsed = await holoInstance.parse(data); // Use instance's parse

                    // Check if the parsed data is a reference that needs resolution
                    if (parsed && holoInstance.isReference(parsed)) { // Use instance's isReference
                        const resolved = await holoInstance.resolveReference(parsed, { // Use instance's resolveReference
                            followReferences: true // Always follow references
                        });

                        if (resolved === null) {
                            console.log(`Reference at ${holon}/${lens}/${parsed.id} points to non-existent data. Deleting reference.`);
                            try {
                                // Use parsed.id as the key for the reference
                                await holoInstance.delete(holon, lens, parsed.id, null); // Use instance's delete
                            } catch (deleteError) {
                                console.error(`Failed to delete invalid reference at ${holon}/${lens}/${parsed.id}:`, deleteError);
                            }
                            // Don't add to output, just return
                            return;
                        }

                        if (resolved !== parsed) {
                            // Reference was resolved successfully
                            // Check again if subscription is still active
                            if (holoInstance.subscriptions[subscriptionId]?.active) {
                                callback(resolved, key);
                            }
                            return;
                        }
                    }

                    // Check again if subscription is still active before final callback
                    if (holoInstance.subscriptions[subscriptionId]?.active) {
                        callback(parsed, key);
                    }
                } catch (error) {
                    console.error('Error in subscribe:', error);
                }
            }
        });

        // Store the subscription with its ID on the instance
        holoInstance.subscriptions[subscriptionId] = {
            id: subscriptionId,
            holon,
            lens,
            active: true,
            callback,
            gunSubscription
        };

        // Return an object with unsubscribe method
        return {
            unsubscribe: () => {
                try {
                    // Mark as inactive first to prevent any new callbacks
                    if (holoInstance.subscriptions[subscriptionId]) {
                        holoInstance.subscriptions[subscriptionId].active = false;
                    }

                    // Turn off the Gun subscription using the stored reference
                    if (holoInstance.subscriptions[subscriptionId]?.gunSubscription) {
                        holoInstance.subscriptions[subscriptionId].gunSubscription.off();
                    }

                    // Remove from subscriptions
                    delete holoInstance.subscriptions[subscriptionId];
                } catch (error) {
                    console.error('Error in unsubscribe:', error);
                }
            }
        };
    } catch (error) {
        console.error('Error creating subscription:', error);
        throw error;
    }
}

/**
 * Notifies subscribers about data changes
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {object} data - The data to notify about
 * @private
 */
export function notifySubscribers(holoInstance, data) {
    if (!data || !data.holon || !data.lens) {
        return;
    }

    try {
        Object.values(holoInstance.subscriptions).forEach(subscription => {
            if (subscription.active &&
                subscription.holon === data.holon &&
                subscription.lens === data.lens) {
                try {
                    if (subscription.callback && typeof subscription.callback === 'function') {
                        subscription.callback(data);
                    }
                } catch (error) {
                    console.warn('Error in subscription callback:', error);
                }
            }
        });
    } catch (error) {
        console.warn('Error notifying subscribers:', error);
    }
}

// Add ID generation method
export function generateId() { // Doesn't need holoInstance
    return Date.now().toString(10) + Math.random().toString(2);
}

/**
 * Closes the HoloSphere instance and cleans up resources.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @returns {Promise<void>}
 */
export async function close(holoInstance) {
    try {
        if (holoInstance.gun) {
            // Unsubscribe from all subscriptions
            const subscriptionIds = Object.keys(holoInstance.subscriptions);
            for (const id of subscriptionIds) {
                try {
                    const subscription = holoInstance.subscriptions[id];
                    if (subscription && subscription.active) {
                        // Turn off the Gun subscription using the stored reference
                        if (subscription.gunSubscription) {
                            subscription.gunSubscription.off();
                        }

                        // Mark as inactive
                        subscription.active = false;
                    }
                } catch (error) {
                    console.warn(`Error cleaning up subscription ${id}:`, error);
                }
            }

            // Clear subscriptions
            holoInstance.subscriptions = {};

            // Clear schema cache using instance method
            holoInstance.clearSchemaCache();

            // Close Gun connections
            if (holoInstance.gun.back) {
                try {
                    // Clean up mesh connections
                    const mesh = holoInstance.gun.back('opt.mesh');
                    if (mesh) {
                        // Clean up mesh.hear
                        if (mesh.hear) {
                            try {
                                // Safely clear mesh.hear without modifying function properties
                                const hearKeys = Object.keys(mesh.hear);
                                for (const key of hearKeys) {
                                    // Check if it's an array before trying to clear it
                                    if (Array.isArray(mesh.hear[key])) {
                                        mesh.hear[key] = [];
                                    }
                                }

                                // Create a new empty object for mesh.hear
                                // Only if mesh.hear is not a function
                                if (typeof mesh.hear !== 'function') {
                                    mesh.hear = {};
                                }
                            } catch (meshError) {
                                console.warn('Error cleaning up Gun mesh hear:', meshError);
                            }
                        }

                        // Close any open sockets in the mesh
                        if (mesh.way) {
                            try {
                                Object.values(mesh.way).forEach(connection => {
                                    if (connection && connection.wire && connection.wire.close) {
                                        connection.wire.close();
                                    }
                                });
                            } catch (sockError) {
                                console.warn('Error closing mesh sockets:', sockError);
                            }
                        }

                        // Clear the peers list
                        if (mesh.opt && mesh.opt.peers) {
                            mesh.opt.peers = {};
                        }
                    }

                    // Attempt to clean up any TCP connections
                    if (holoInstance.gun.back('opt.web')) {
                        try {
                            const server = holoInstance.gun.back('opt.web');
                            if (server && server.close) {
                                server.close();
                            }
                        } catch (webError) {
                            console.warn('Error closing web server:', webError);
                        }
                    }
                } catch (error) {
                    console.warn('Error accessing Gun mesh:', error);
                }
            }

            // Clear all Gun instance listeners
            try {
                holoInstance.gun.off();
            } catch (error) {
                console.warn('Error turning off Gun listeners:', error);
            }

            // Wait a moment for cleanup to complete
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log('HoloSphere instance closed successfully');
    } catch (error) {
        console.error('Error closing HoloSphere instance:', error);
    }
}

/**
 * Creates a namespaced username for Gun authentication
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holonId - The holon ID
 * @returns {string} - Namespaced username
 */
export function userName(holoInstance, holonId) {
    if (!holonId) return null;
    return `${holoInstance.appname}:${holonId}`;
} 