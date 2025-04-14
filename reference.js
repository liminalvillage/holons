// holo_reference.js

/**
 * Creates a soul reference object for a data item
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - The holon where the original data is stored
 * @param {string} lens - The lens where the original data is stored
 * @param {object} data - The data to create a reference for
 * @returns {object} - A reference object with id and soul
 */
export function createReference(holoInstance, holon, lens, data) {
    if (!holon || !lens || !data || !data.id) {
        throw new Error('createReference: Missing required parameters');
    }

    const soul = `${holoInstance.appname}/${holon}/${lens}/${data.id}`;
    return {
        id: data.id,
        soul: soul
    };
}

/**
 * Parses a soul path into its components
 * @param {string} soul - The soul path to parse
 * @returns {object|null} - The parsed components or null if invalid format
 */
export function parseSoulPath(soul) { // Doesn't need holoInstance
    if (!soul || typeof soul !== 'string') {
        return null;
    }

    const soulParts = soul.split('/');
    if (soulParts.length < 4) {
        return null;
    }

    return {
        appname: soulParts[0],
        holon: soulParts[1],
        lens: soulParts[2],
        key: soulParts[3]
    };
}

/**
 * Checks if an object is a reference
 * @param {object} data - The data to check
 * @returns {boolean} - True if the object is a reference
 */
export function isReference(data) { // Doesn't need holoInstance
    if (!data || typeof data !== 'object') {
        return false;
    }

    // Check for direct soul reference
    if (data.soul && typeof data.soul === 'string' && data.id) {
        return true;
    }

    return false;
}

/**
 * Resolves a reference to its actual data
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {object} reference - The reference to resolve
 * @param {object} [options] - Optional parameters
 * @param {boolean} [options.followReferences=true] - Whether to follow nested references
 * @param {Set<string>} [options.visited] - Internal use: Tracks visited souls to prevent loops
 * @returns {Promise<object|null>} - The resolved data, null if resolution failed due to target not found, or the original reference for circular/invalid cases.
 */
export async function resolveReference(holoInstance, reference, options = {}) {
    if (!isReference(reference)) { // Use exported isReference
        return reference; // Not a reference, return as is
    }

    const { followReferences = true, visited = new Set() } = options;

    // Check for circular reference
    if (reference.soul && visited.has(reference.soul)) {
        console.warn(`Circular reference detected for soul: ${reference.soul}. Returning original reference.`);
        return reference;
    }

    try {
        // Handle direct soul reference
        if (reference.soul) {
            const soulInfo = parseSoulPath(reference.soul); // Use exported parseSoulPath
            if (!soulInfo) {
                console.warn(`Invalid soul format: ${reference.soul}`);
                return reference;
            }

            // Add current soul to visited set
            visited.add(reference.soul);

            console.log(`Resolving reference with soul: ${reference.soul}`);

            // Get original data using the extracted path components and instance methods
            const originalData = await holoInstance.get(
                soulInfo.holon,
                soulInfo.lens,
                soulInfo.key,
                null,
                {
                    resolveReferences: followReferences, // Control recursion
                    visited: visited // Pass the visited set along
                }
            );

            // Remove from visited set after the call returns (optional, depends on desired behavior)
            // visited.delete(reference.soul);

            if (originalData) {
                console.log(`Original data found through soul path resolution`);
                return {
                    ...originalData,
                    _federation: {
                        isReference: true,
                        resolved: true,
                        soul: reference.soul,
                        timestamp: Date.now()
                    }
                };
            } else {
                console.warn(`Could not resolve reference: original data not found at ${soulInfo.holon}/${soulInfo.lens}/${soulInfo.key}. Returning null to signal deletion.`);
                return null; // Signal to the caller that the reference is invalid and should be deleted
            }
        }

        return reference; // Return original reference if resolution fails
    } catch (error) {
        console.error(`Error resolving reference: ${error.message}`, error);
        return reference;
    } finally {
        // Ensure the soul is removed if the function exits early due to error
        // This removal might not be necessary depending on how you want to handle errors within a loop.
        // If an error occurs during resolution, keeping it in 'visited' might prevent retries.
        // If you want retries, uncomment the delete.
        // if (reference.soul) {
        //    visited.delete(reference.soul);
        // }
    }
} 