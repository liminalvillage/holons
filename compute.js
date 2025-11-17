// holo_compute.js
import * as h3 from 'h3-js';

/**
 * Computes operations across multiple layers up the hierarchy
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - Starting holon identifier
 * @param {string} lens - The lens to compute
 * @param {object} options - Computation options
 * @param {number} [maxLevels=15] - Maximum levels to compute up
 * @param {string} [password] - Optional password for private holons
 */
export async function computeHierarchy(holoInstance, holon, lens, options, maxLevels = 15, password = null) {
    let currentHolon = holon;
    let currentRes = h3.getResolution(currentHolon);
    const results = [];

    while (currentRes > 0 && maxLevels > 0) {
        try {
            // Use the instance's compute method
            const result = await holoInstance.compute(currentHolon, lens, options, password);
            if (result) {
                results.push(result);
            }
            currentHolon = h3.cellToParent(currentHolon, currentRes - 1);
            currentRes--;
            maxLevels--;
        } catch (error) {
            console.error('Error in compute hierarchy:', error);
            break;
        }
    }

    return results;
}

/**
 * Computes operations on content within a holon and lens for one layer up.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - The holon identifier.
 * @param {string} lens - The lens to compute.
 * @param {object} options - Computation options
 * @param {string} options.operation - The operation to perform ('summarize', 'aggregate', 'concatenate')
 * @param {string[]} [options.fields] - Fields to perform operation on
 * @param {string} [options.targetField] - Field to store the result in
 * @param {string} [password] - Optional password for private holons
 * @throws {Error} If parameters are invalid or missing
 */
export async function compute(holoInstance, holon, lens, options, password = null) {
    // Validate required parameters
    if (!holon || !lens) {
        throw new Error('compute: Missing required parameters');
    }

    // Convert string operation to options object
    if (typeof options === 'string') {
        options = { operation: options };
    }

    if (!options?.operation) {
        throw new Error('compute: Missing required parameters');
    }

    // Validate holon format and resolution first
    let res;
    try {
        res = h3.getResolution(holon);
    } catch (error) {
        throw new Error('compute: Invalid holon format');
    }

    if (res < 1 || res > 15) {
        throw new Error('compute: Invalid holon resolution (must be between 1 and 15)');
    }

    const {
        operation,
        fields = [],
        targetField,
        depth,
        maxDepth
    } = options;

    // Validate depth parameters if provided
    if (depth !== undefined && depth < 0) {
        throw new Error('compute: Invalid depth parameter');
    }

    if (maxDepth !== undefined && (maxDepth < 1 || maxDepth > 15)) {
        throw new Error('compute: Invalid maxDepth parameter (must be between 1 and 15)');
    }

    // Validate operation
    const validOperations = ['summarize', 'aggregate', 'concatenate'];
    if (!validOperations.includes(operation)) {
        throw new Error(`compute: Invalid operation (must be one of ${validOperations.join(', ')})`);
    }

    const parent = h3.cellToParent(holon, res - 1);
    const siblings = h3.cellToChildren(parent, res);

    // Collect all content from siblings using instance's getAll
    const contents = await Promise.all(
        siblings.map(sibling => holoInstance.getAll(sibling, lens, password))
    );

    const flatContents = contents.flat().filter(Boolean);

    if (flatContents.length > 0) {
        try {
            let computed;
            switch (operation) {
                case 'summarize':
                    // For summarize, concatenate specified fields or use entire content
                    const textToSummarize = fields.length > 0
                        ? flatContents.map(item => fields.map(field => item[field]).filter(Boolean).join('\n')).join('\n')
                        : JSON.stringify(flatContents);
                    computed = await holoInstance.summarize(textToSummarize); // Use instance's summarize
                    break;

                case 'aggregate':
                    // For aggregate, sum numeric fields
                    computed = fields.reduce((acc, field) => {
                        acc[field] = flatContents.reduce((sum, item) => {
                            return sum + (Number(item[field]) || 0);
                        }, 0);
                        return acc;
                    }, {});
                    break;

                case 'concatenate':
                    // For concatenate, combine arrays or strings
                    computed = fields.reduce((acc, field) => {
                        acc[field] = flatContents.reduce((combined, item) => {
                            const value = item[field];
                            if (Array.isArray(value)) {
                                return [...combined, ...value];
                            } else if (value) {
                                return [...combined, value];
                            }
                            return combined;
                        }, []);
                        // Remove duplicates if array
                        acc[field] = Array.from(new Set(acc[field]));
                        return acc;
                    }, {});
                    break;
            }

            if (computed) {
                const resultId = `${parent}_${operation}`;
                const result = {
                    id: resultId,
                    timestamp: Date.now()
                };

                // Store result in targetField if specified, otherwise at root level
                if (targetField) {
                    result[targetField] = computed;
                } else if (typeof computed === 'object') {
                    Object.assign(result, computed);
                } else {
                    result.value = computed;
                }

                await holoInstance.put(parent, lens, result, password); // Use instance's put
                return result;
            }
        } catch (error) {
            console.warn('Error in compute operation:', error);
            throw error;
        }
    }

    return null;
}

/**
 * Summarizes provided history text using OpenAI.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} history - The history text to summarize.
 * @returns {Promise<string>} - The summarized text.
 */
export async function summarize(holoInstance, history) {
    if (!holoInstance.openai) {
        return 'OpenAI not initialized, please specify the API key in the constructor.'
    }

    try {
        const response = await holoInstance.openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                {
                    role: "system",
                    content: "You are a helpful assistant that summarizes text concisely while preserving key information. Keep summaries clear and focused."
                },
                {
                    role: "user",
                    content: history
                }
            ],
            temperature: 0.7,
            max_tokens: 500
        });

        return response.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error in summarize:', error);
        throw new Error('Failed to generate summary');
    }
}

/**
 * Upcasts content to parent holonagons recursively using holograms.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - The current holon identifier.
 * @param {string} lens - The lens under which to upcast.
 * @param {object} content - The content to upcast.
 * @param {number} [maxLevels=15] - Maximum levels to upcast.
 * @returns {Promise<object>} - The original content.
 */
export async function upcast(holoInstance, holon, lens, content, maxLevels = 15) {
    // Store the actual content at the original resolution using instance's put
    await holoInstance.put(holon, lens, content);

    let res = h3.getResolution(holon);

    // If already at the highest level (res 0) or reached max levels, we're done
    if (res === 0 || maxLevels <= 0) {
        return content;
    }

    // Get the parent cell
    let parent = h3.cellToParent(holon, res - 1);

    // Create a hologram to store in the parent using instance's createHologram
    const hologram = holoInstance.createHologram(holon, lens, content);

    // Store the hologram in the parent cell using instance's put
    await holoInstance.put(parent, lens, hologram, null, {
        autoPropagate: false
    });

    // Continue upcasting with the parent using instance's upcast
    if (res > 1 && maxLevels > 1) {
        // Recursively call the instance's upcast method
        // Pass the *hologram* to the next level, not the original content
        return holoInstance.upcast(parent, lens, hologram, maxLevels - 1);
    }

    return content;
}

/**
 * Updates the parent holon with a new report.
 * Note: This function assumes the existence of `getCellInfo` and `db.put` on the holoInstance,
 * which were not defined in the original class. Adjust as needed.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} id - The child holon identifier.
 * @param {string} report - The report to update.
 * @returns {Promise<object>} - The updated parent information.
 */
export async function updateParent(holoInstance, id, report) {
    // Check if required methods exist on the instance
    if (typeof holoInstance.getCellInfo !== 'function' || !holoInstance.db || typeof holoInstance.db.put !== 'function') {
        console.warn('updateParent requires getCellInfo and db.put methods on the HoloSphere instance.');
        // Decide how to handle this: throw error, return null, etc.
        // For now, let's proceed assuming they might exist but log a warning.
    }

    try {
        let cellinfo = await holoInstance.getCellInfo(id)
        let res = h3.getResolution(id)
        let parent = h3.cellToParent(id, res - 1)
        let parentInfo = await holoInstance.getCellInfo(parent)
        parentInfo.wisdom[id] = report
        //update summary using instance's summarize
        let summary = await holoInstance.summarize(Object.values(parentInfo.wisdom).join('\n'))
        parentInfo.summary = summary

        // Assuming db is accessible like this
        await holoInstance.db.put('cell', parentInfo)
        return parentInfo
    } catch (error) {
        console.error("Error during updateParent:", error);
        // Re-throw or handle error appropriately
        throw error;
    }
} 

// Export all compute operations as default
export default {
    computeHierarchy,
    compute,
    summarize,
    upcast,
    updateParent
}; 