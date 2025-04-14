// holo_schema.js

import Ajv2019 from 'ajv/dist/2019.js';

/**
 * Sets the JSON schema for a specific lens.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} lens - The lens identifier.
 * @param {object} schema - The JSON schema to set.
 * @returns {Promise<boolean>} - Resolves when the schema is set.
 */
export async function setSchema(holoInstance, lens, schema) {
    if (!lens || !schema) {
        throw new Error('setSchema: Missing required parameters');
    }

    // Basic schema validation
    if (!schema.type || typeof schema.type !== 'string') {
        throw new Error('setSchema: Schema must have a type field');
    }

    const metaSchema = {
        type: 'object',
        required: ['type', 'properties'],
        properties: {
            type: { type: 'string' },
            properties: {
                type: 'object',
                additionalProperties: {
                    type: 'object',
                    required: ['type'],
                    properties: {
                        type: { type: 'string' }
                    }
                }
            },
            required: {
                type: 'array',
                items: { type: 'string' }
            }
        }
    };

    // Use the validator from the instance
    const valid = holoInstance.validator.validate(metaSchema, schema);
    if (!valid) {
        throw new Error(`Invalid schema structure: ${JSON.stringify(holoInstance.validator.errors)}`);
    }

    if (!schema.properties || typeof schema.properties !== 'object') {
        throw new Error('Schema must have properties in strict mode');
    }

    if (!schema.required || !Array.isArray(schema.required) || schema.required.length === 0) {
        throw new Error('Schema must have required fields in strict mode');
    }

    // Store schema in global table with lens as key using instance's method
    await holoInstance.putGlobal('schemas', {
        id: lens,
        schema: schema,
        timestamp: Date.now()
    });

    // Update the instance's cache with the new schema
    holoInstance.schemaCache.set(lens, {
        schema,
        timestamp: Date.now()
    });

    return true;
}

/**
 * Retrieves the JSON schema for a specific lens.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} lens - The lens identifier.
 * @param {object} [options] - Additional options
 * @param {boolean} [options.useCache=true] - Whether to use the schema cache
 * @param {number} [options.maxCacheAge=3600000] - Maximum cache age in milliseconds (default: 1 hour)
 * @returns {Promise<object|null>} - The retrieved schema or null if not found.
 */
export async function getSchema(holoInstance, lens, options = {}) {
    if (!lens) {
        throw new Error('getSchema: Missing lens parameter');
    }

    const { useCache = true, maxCacheAge = 3600000 } = options;

    // Check instance's cache first if enabled
    if (useCache && holoInstance.schemaCache.has(lens)) {
        const cached = holoInstance.schemaCache.get(lens);
        const cacheAge = Date.now() - cached.timestamp;

        // Use cache if it's fresh enough
        if (cacheAge < maxCacheAge) {
            return cached.schema;
        }
    }

    // Cache miss or expired, fetch from storage using instance's method
    const schemaData = await holoInstance.getGlobal('schemas', lens);

    if (!schemaData || !schemaData.schema) {
        return null;
    }

    // Update instance's cache with fetched schema
    holoInstance.schemaCache.set(lens, {
        schema: schemaData.schema,
        timestamp: Date.now()
    });

    return schemaData.schema;
}

/**
 * Clears the schema cache or a specific schema from the cache.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} [lens] - Optional lens to clear from cache. If not provided, clears entire cache.
 * @returns {boolean} - Returns true if successful
 */
export function clearSchemaCache(holoInstance, lens = null) {
    if (lens) {
        // Clear specific schema from instance's cache
        return holoInstance.schemaCache.delete(lens);
    } else {
        // Clear entire instance's cache
        holoInstance.schemaCache.clear();
        return true;
    }
} 