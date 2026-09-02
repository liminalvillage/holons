// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Path-based subscription wrapper (v2-compatible API) over the store's
// change feed.

/**
 * Build a lens path string
 */
export function buildLensPath(appName, holonId, lens) {
    return `${appName}/${holonId}/${lens}`;
}

/**
 * Parse a lens path into its components
 * @returns {{ appName: string, holonId: string, lens: string } | null}
 */
function parseLensPath(path) {
    const parts = String(path).split('/');
    if (parts.length < 3) return null;
    return {
        appName: parts[0],
        holonId: parts[1],
        lens: parts.slice(2).join('/')
    };
}

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

export const subscriptions = {
    /**
     * Create a subscription to a lens path
     * @param {object} client - The HoloSphere instance
     * @param {string} path - The lens path (appName/holonId/lens)
     * @param {function} callback - Callback for data changes
     * @param {object} [options]
     * @param {boolean} [options.realtimeOnly] - Only fire for new changes (skip the snapshot)
     * @param {boolean} [options.resolveHolograms] - Resolve hologram pointers before delivery
     * @returns {{ unsubscribe: () => void, stop: () => void }}
     */
    createSubscription(client, path, callback, options = {}) {
        const parsed = parseLensPath(path);
        if (!parsed || !client?.store) {
            console.warn('[subscriptions] Invalid path or client:', path);
            return { unsubscribe: () => {}, stop: () => {} };
        }
        let active = true;
        const off = client.store.watch(parsed.holonId, parsed.lens, async (item, key, meta) => {
            if (!active || meta.tombstone) return;
            try {
                const value = clone(item);
                if (options.resolveHolograms && client.isHologram && client.isHologram(value)) {
                    try {
                        const resolved = await client.resolveHologram(value, { followHolograms: true });
                        if (!active) return;
                        if (resolved && resolved !== value) {
                            callback(resolved, key);
                            return;
                        }
                    } catch (e) {
                        console.warn('[subscriptions] Failed to resolve hologram:', e);
                    }
                }
                callback(value, key);
            } catch (e) {
                console.warn('[subscriptions] Error processing subscription data:', e);
            }
        }, { replay: !options.realtimeOnly });

        const unsub = () => { active = false; off(); };
        return { unsubscribe: unsub, stop: unsub };
    }
};

export default { subscriptions, buildLensPath };
