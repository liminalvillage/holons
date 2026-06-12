/**
 * GunDB-based subscription wrapper for HoloSphere v1.3
 * Provides v2-compatible subscription API backed by Gun.js
 */

/**
 * Build a lens path string
 * @param {string} appName - Application name
 * @param {string} holonId - Holon identifier
 * @param {string} lens - Lens name
 * @returns {string} Combined path
 */
export function buildLensPath(appName, holonId, lens) {
    return `${appName}/${holonId}/${lens}`;
}

/**
 * Parse a lens path into its components
 * @param {string} path - The path to parse
 * @returns {{ appName: string, holonId: string, lens: string } | null}
 */
function parseLensPath(path) {
    const parts = path.split('/');
    if (parts.length < 3) return null;
    return {
        appName: parts[0],
        holonId: parts[1],
        lens: parts.slice(2).join('/')
    };
}

export const subscriptions = {
    /**
     * Create a subscription to a GunDB path
     * @param {object} client - The HoloSphere instance
     * @param {string} path - The lens path (appName/holonId/lens)
     * @param {function} callback - Callback for data changes
     * @param {object} [options] - Subscription options
     * @param {boolean} [options.realtimeOnly] - Only fire for new changes (not initial data)
     * @param {boolean} [options.resolveHolograms] - Whether to resolve hologram references
     * @param {string} [options.appname] - Application name override
     * @returns {{ unsubscribe: () => void, stop: () => void }}
     */
    createSubscription(client, path, callback, options = {}) {
        const parsed = parseLensPath(path);
        if (!parsed) {
            console.warn('[subscriptions] Invalid path:', path);
            return { unsubscribe: () => {}, stop: () => {} };
        }

        const gun = client.gun || client;
        const dataPath = gun.get(parsed.appName).get(parsed.holonId).get(parsed.lens);
        let active = true;
        let initialLoadComplete = false;

        // Track initial data load for realtimeOnly mode
        if (options.realtimeOnly) {
            // First do a .once() pass to mark initial data as loaded
            dataPath.once(() => {
                setTimeout(() => { initialLoadComplete = true; }, 100);
            });
        } else {
            initialLoadComplete = true;
        }

        const handler = dataPath.map().on(async (data, key) => {
            if (!active) return;
            if (options.realtimeOnly && !initialLoadComplete) return;
            if (!data || key === '_') return;

            try {
                let parsed;
                if (typeof data === 'string') {
                    try {
                        parsed = JSON.parse(data);
                    } catch (e) {
                        parsed = data;
                    }
                } else {
                    // Clean Gun metadata
                    const cleaned = { ...data };
                    delete cleaned._;
                    parsed = cleaned;
                }

                // Resolve holograms if requested and client supports it
                if (options.resolveHolograms && client.isHologram && client.isHologram(parsed)) {
                    try {
                        const resolved = await client.resolveHologram(parsed, { followHolograms: true });
                        if (resolved && resolved !== parsed) {
                            callback(resolved, key);
                            return;
                        }
                    } catch (e) {
                        console.warn('[subscriptions] Failed to resolve hologram:', e);
                    }
                }

                callback(parsed, key);
            } catch (e) {
                console.warn('[subscriptions] Error processing subscription data:', e);
            }
        });

        const unsub = () => {
            active = false;
            dataPath.off();
        };

        return {
            unsubscribe: unsub,
            stop: unsub
        };
    }
};

export default { subscriptions, buildLensPath };
