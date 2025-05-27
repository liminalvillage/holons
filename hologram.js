// holo_hologram.js

/**
 * Creates a soul hologram object for a data item
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - The holon where the original data is stored
 * @param {string} lens - The lens where the original data is stored
 * @param {object} data - The data to create a hologram for
 * @returns {object} - A hologram object with id and soul
 */
export function createHologram(holoInstance, holon, lens, data) {
    // Check if the input data is already a hologram
    if (isHologram(data)) {
        // If it is, just return its existing ID and Soul, ignoring the provided holon/lens
        console.warn('createHologram called with data that is already a hologram. Reusing existing soul:', data.soul);
        return {
            id: data.id,
            soul: data.soul
        };
    }

    // Original logic: Input data is not a hologram, create a new soul path
    if (!holon || !lens || !data || !data.id) {
        throw new Error('createHologram: Missing required parameters for non-hologram data');
    }

    const soul = `${holoInstance.appname}/${holon}/${lens}/${data.id}`;
    return {
        id: data.id,
        soul: soul
    };
}

/**
 * Parses a soul path into its components.
 * @param {string} soul - The soul path (e.g., "app/holon/lens/key").
 * @returns {object|null} - An object with appname, holon, lens, key, or null if invalid.
 */
export function parseSoulPath(soul) {
    if (typeof soul !== 'string') return null;
    const parts = soul.split('/');
    if (parts.length < 4) return null; // Must have at least app/holon/lens/key

    // Reconstruct key if it contained slashes (though generally disallowed by getNodeRef validation)
    const key = parts.slice(3).join('/');

    return {
        appname: parts[0],
        holon: parts[1],
        lens: parts[2],
        key: key
    };
}

/**
 * Checks if an object is a hologram.
 * This function checks for the presence and type of `id` and `soul` properties,
 * suitable for identifying holograms represented as plain JavaScript objects.
 * It also performs a basic check that the `soul` contains '/' as expected for a path.
 * @param {object | null | undefined} data - The data to check.
 * @returns {boolean} - True if the object is considered a hologram.
 */
export function isHologram(data) {
    if (!data || typeof data !== 'object') {
        return false;
    }
    
    // Basic check: Does it have an 'id' and a 'soul' which is a non-empty string?
    if (data.id && typeof data.soul === 'string' && data.soul.length > 0) {
         // Optional stricter check: Does the soul look like a valid path?
         // This prevents objects like { id: 1, soul: "hello" } from being counted.
         // We can use a simplified check here or rely on parseSoulPath failing later.
         if (data.soul.includes('/')) { // Simple check for path structure
            return true;
         } 
    }

    return false;
}

/**
 * Resolves a hologram to its actual data
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {object} hologram - The hologram to resolve
 * @param {object} [options] - Optional parameters
 * @param {boolean} [options.followHolograms=true] - Whether to follow nested holograms
 * @param {Set<string>} [options.visited] - Internal use: Tracks visited souls to prevent loops
 * @returns {Promise<object|null>} - The resolved data, null if resolution failed due to target not found, or the original hologram for circular/invalid cases.
 */
export async function resolveHologram(holoInstance, hologram, options = {}) {
    if (!isHologram(hologram)) {
        return hologram; // Not a hologram, return as is
    }

    const { followHolograms = true, visited = new Set() } = options;

    // Check for circular hologram FIRST
    if (hologram.soul && visited.has(hologram.soul)) {
        console.warn(`!!! CIRCULAR hologram detected for soul: ${hologram.soul}. Returning original hologram.`);
        throw new Error(`CIRCULAR_REFERENCE:${hologram.soul}`);
    } else {
        try {
            // Handle direct soul hologram
            if (hologram.soul) {
                const soulInfo = parseSoulPath(hologram.soul);
                if (!soulInfo) {
                    console.warn(`Invalid soul format: ${hologram.soul}`);
                    return hologram;
                }

                // Add current soul to visited set for THIS resolution path
                const nextVisited = new Set(visited);
                nextVisited.add(hologram.soul);

                console.log(`Resolving hologram with soul: ${hologram.soul}`);

                // Get original data
                const originalData = await holoInstance.get(
                    soulInfo.holon,
                    soulInfo.lens,
                    soulInfo.key,
                    null,
                    {
                        resolveHolograms: followHolograms,
                        visited: nextVisited
                    }
                );

                console.log('### resolveHologram received originalData:', originalData);

                if (originalData) {
                    console.log(`### Returning RESOLVED data for soul: ${hologram.soul}`);
                    // Structure for the returned object - isHologram (top-level) is removed
                    return {
                        ...originalData,
                        _meta: {
                            ...(originalData._meta || {}), // Preserve original _meta
                            resolvedFromHologram: true,    // This is now the primary indicator
                            hologramSoul: hologram.soul     // Clarified meta field
                        }
                    };
                } else {
                    console.warn(`!!! Original data NOT FOUND for soul: ${hologram.soul}. Returning null.`);
                    return null;
                }
            } else {
                 // Should not happen if isHologram() passed
                 console.warn('!!! resolveHologram called with object missing soul:', hologram);
                 return hologram;
            }
        } catch (error) {
            console.error(`!!! Error resolving hologram: ${error.message}`, error);
            return hologram; // Return original hologram on error
        }
    }
} 