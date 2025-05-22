/**
 * @module holosphere
 * @version 1.1.11
 * @description Holonic Geospatial Communication Infrastructure
 * @author Roberto Valenti
 * @license GPL-3.0-or-later
 */

import * as h3 from 'h3-js';
import OpenAI from 'openai';
import Gun from 'gun'
import Ajv2019 from 'ajv/dist/2019.js'
import * as Federation from './federation.js';
import * as SchemaOps from './schema.js';
import * as ContentOps from './content.js';
import * as NodeOps from './node.js';
import * as GlobalOps from './global.js';
import * as HologramOps from './hologram.js';
import * as ComputeOps from './compute.js';
import * as Utils from './utils.js';

// Define the version constant
const HOLOSPHERE_VERSION = '1.1.11'; 

class HoloSphere {
    /**
     * Initializes a new instance of the HoloSphere class.
     * @param {string} appname - The name of the application.
     * @param {boolean} [strict=false] - Whether to enforce strict schema validation.
     * @param {string|null} [openaikey=null] - The OpenAI API key.
     * @param {object} [gunOptions={}] - Optional Gun constructor options (e.g., peers, localStorage, radisk).
     */
    constructor(appname, strict = false, openaikey = null, gunOptions = {}) {
        console.log('HoloSphere v' + HOLOSPHERE_VERSION);
        this.appname = appname
        this.strict = strict;
        this.validator = new Ajv2019({
            allErrors: true,
            strict: false,  // Keep this false to avoid Ajv strict mode issues
            validateSchema: true // Always validate schemas
        });

       
        // Define default Gun options
        const defaultGunOptions = {
            peers: ['https://gun.holons.io/gun'],
            axe: false,
            // Add other potential defaults here if needed
        };

        // Merge provided options with defaults
        const finalGunOptions = { ...defaultGunOptions, ...gunOptions };
        console.log("Initializing Gun with options:", finalGunOptions);

        // Use provided Gun instance or create new one with final options
        this.gun = Gun(finalGunOptions); // Pass the merged options
    

        if (openaikey != null) {
            this.openai = new OpenAI({
                apiKey: openaikey,
            });
        }

        // Initialize subscriptions
        this.subscriptions = {};
        
        // Initialize schema cache
        this.schemaCache = new Map();
    }

    getGun() {
        return this.gun;
    }

    // ================================ SCHEMA FUNCTIONS ================================

    /**
     * Sets the JSON schema for a specific lens.
     * @param {string} lens - The lens identifier.
     * @param {object} schema - The JSON schema to set.
     * @returns {Promise} - Resolves when the schema is set.
     */
    async setSchema(lens, schema) {
        // Delegate to the external function
        return SchemaOps.setSchema(this, lens, schema);
    }

    /**
     * Retrieves the JSON schema for a specific lens.
     * @param {string} lens - The lens identifier.
     * @param {object} [options] - Additional options
     * @param {boolean} [options.useCache=true] - Whether to use the schema cache
     * @param {number} [options.maxCacheAge=3600000] - Maximum cache age in milliseconds (default: 1 hour)
     * @returns {Promise<object|null>} - The retrieved schema or null if not found.
     */
    async getSchema(lens, options = {}) {
        // Delegate to the external function
        return SchemaOps.getSchema(this, lens, options);
    }

    /**
     * Clears the schema cache or a specific schema from the cache.
     * @param {string} [lens] - Optional lens to clear from cache. If not provided, clears entire cache.
     * @returns {boolean} - Returns true if successful
     */
    clearSchemaCache(lens = null) {
        // Delegate to the external function
        return SchemaOps.clearSchemaCache(this, lens);
    }

    // ================================ CONTENT FUNCTIONS ================================

    /**
     * Stores content in the specified holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens under which to store the content.
     * @param {object} data - The data to store.
     * @param {string} [password] - Optional password for private holon.
     * @param {object} [options] - Additional options
     * @param {boolean} [options.autoPropagate=true] - Whether to automatically propagate to federated holons (default: true)
     * @param {object} [options.propagationOptions] - Options to pass to propagate
     * @param {boolean} [options.propagationOptions.useReferences=true] - Whether to use references instead of duplicating data
     * @returns {Promise<boolean>} - Returns true if successful, false if there was an error
     */
    async put(holon, lens, data, password = null, options = {}) {
        // Delegate to the external function
        return ContentOps.put(this, holon, lens, data, password, options);
    }

    /**
     * Retrieves content from the specified holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens from which to retrieve content.
     * @param {string} key - The specific key to retrieve.
     * @param {string} [password] - Optional password for private holon.
     * @param {object} [options] - Additional options
     * @param {boolean} [options.resolveReferences=true] - Whether to automatically resolve federation references
     * @returns {Promise<object|null>} - The retrieved content or null if not found.
     */
    async get(holon, lens, key, password = null, options = {}) {
        // Delegate to the external function
        return ContentOps.get(this, holon, lens, key, password, options);
    }

    /**
     * Retrieves all content from the specified holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens from which to retrieve content.
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<Array<object>>} - The retrieved content.
     */
    async getAll(holon, lens, password = null) {
        // Delegate to the external function
        return ContentOps.getAll(this, holon, lens, password);
    }

    /**
   * Parses data from GunDB, handling various data formats and references.
   * @param {*} data - The data to parse, could be a string, object, or GunDB reference.
   * @returns {Promise<object>} - The parsed data.
   */
    async parse(rawData) {
        // Delegate to the external function
        return ContentOps.parse(this, rawData);
    }

    /**
     * Deletes a specific key from a given holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens from which to delete the key.
     * @param {string} key - The specific key to delete.
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<boolean>} - Returns true if successful
     */
    async delete(holon, lens, key, password = null) {
        // Delegate to the external function (renamed to deleteFunc in module)
        return ContentOps.deleteFunc(this, holon, lens, key, password);
    }

    /**
     * Deletes all keys from a given holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens from which to delete all keys.
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<boolean>} - Returns true if successful
     */
    async deleteAll(holon, lens, password = null) {
        // Delegate to the external function
        return ContentOps.deleteAll(this, holon, lens, password);
    }

    // ================================ NODE FUNCTIONS ================================


    /**
     * Stores a specific gun node in a given holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens under which to store the node.
     * @param {object} data - The node to store.
     */
    async putNode(holon, lens, data) {
        // Delegate to the external function
        return NodeOps.putNode(this, holon, lens, data);
    }

    /**
     * Retrieves a specific gun node from the specified holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens identifier.
     * @param {string} key - The specific key to retrieve.
     * @returns {Promise<any>} - The retrieved node or null if not found.
     */
    async getNode(holon, lens, key) {
        // Delegate to the external function
        return NodeOps.getNode(this, holon, lens, key);
    }

    /**
     * Retrieves a Gun node reference using its soul path
     * @param {string} soul - The soul path of the node
     * @returns {Gun.ChainReference} - The Gun node reference
     */
    getNodeRef(soul) {
        // Delegate to the external function
        return NodeOps.getNodeRef(this, soul);
    }

    /**
     * Retrieves a node directly using its soul path
     * @param {string} soul - The soul path of the node
     * @returns {Promise<any>} - The retrieved node or null if not found.
     */
    async getNodeBySoul(soul) {
        // Delegate to the external function
        return NodeOps.getNodeBySoul(this, soul);
    }

    /**
     * Deletes a specific gun node from a given holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens identifier.
     * @param {string} key - The key of the node to delete.
     * @returns {Promise<boolean>} - Returns true if successful
     */
    async deleteNode(holon, lens, key) {
        // Delegate to the external function
        return NodeOps.deleteNode(this, holon, lens, key);
    }

    // ================================ GLOBAL FUNCTIONS ================================
    /**
     * Stores data in a global (non-holon-specific) table.
     * @param {string} tableName - The table name to store data in.
     * @param {object} data - The data to store. If it has an 'id' field, it will be used as the key.
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<void>}
     */
    async putGlobal(tableName, data, password = null) {
        // Delegate to the external function
        return GlobalOps.putGlobal(this, tableName, data, password);
    }

    /**
     * Retrieves a specific key from a global table.
     * @param {string} tableName - The table name to retrieve from.
     * @param {string} key - The key to retrieve.
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<object|null>} - The parsed data for the key or null if not found.
     */
    async getGlobal(tableName, key, password = null) {
        // Delegate to the external function
        return GlobalOps.getGlobal(this, tableName, key, password);
    }

    /**
     * Retrieves all data from a global table.
     * @param {string} tableName - The table name to retrieve data from.
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<Array<object>>} - The parsed data from the table as an array.
     */
    async getAllGlobal(tableName, password = null) {
        // Delegate to the external function
        return GlobalOps.getAllGlobal(this, tableName, password);
    }

    /**
     * Deletes a specific key from a global table.
     * @param {string} tableName - The table name to delete from.
     * @param {string} key - The key to delete.
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<boolean>}
     */
    async deleteGlobal(tableName, key, password = null) {
        // Delegate to the external function
        return GlobalOps.deleteGlobal(this, tableName, key, password);
    }

    /**
     * Deletes an entire global table.
     * @param {string} tableName - The table name to delete.
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<boolean>}
     */
    async deleteAllGlobal(tableName, password = null) {
        // Delegate to the external function
        return GlobalOps.deleteAllGlobal(this, tableName, password);
    }

    // ================================ REFERENCE FUNCTIONS ================================

    /**
     * Creates a soul hologram object for a data item
     * @param {string} holon - The holon where the original data is stored
     * @param {string} lens - The lens where the original data is stored
     * @param {object} data - The data to create a hologram for
     * @returns {object} - A hologram object with id and soul
     */
    createHologram(holon, lens, data) {
        // Delegate to the external function
        return HologramOps.createHologram(this, holon, lens, data);
    }
    
    /**
     * Parses a soul path into its components
     * @param {string} soul - The soul path to parse
     * @returns {object|null} - The parsed components or null if invalid format
     */
    parseSoulPath(soul) {
        // Delegate to the external function (doesn't need instance)
        return HologramOps.parseSoulPath(soul);
    }
    
    /**
     * Checks if an object is a hologram
     * @param {object} data - The data to check
     * @returns {boolean} - True if the object is a hologram
     */
    isHologram(data) {
        // Delegate to the external function (doesn't need instance)
        return HologramOps.isHologram(data);
    }
    
    /**
     * Resolves a hologram to its actual data
     * @param {object} hologram - The hologram to resolve
     * @param {object} [options] - Optional parameters
     * @param {boolean} [options.followHolograms=true] - Whether to follow nested holograms
     * @param {Set<string>} [options.visited] - Internal use: Tracks visited souls to prevent loops
     * @returns {Promise<object|null>} - The resolved data, null if resolution failed due to target not found, or the original hologram for circular/invalid cases.
     */
    async resolveHologram(hologram, options = {}) {
        // Delegate to the external function
        return HologramOps.resolveHologram(this, hologram, options);
    }

    // ================================ COMPUTE FUNCTIONS ================================
    /**
     * Computes operations across multiple layers up the hierarchy
     * @param {string} holon - Starting holon identifier
     * @param {string} lens - The lens to compute
     * @param {object} options - Computation options
     * @param {number} [maxLevels=15] - Maximum levels to compute up
     * @param {string} [password] - Optional password for private holons
     */
    async computeHierarchy(holon, lens, options, maxLevels = 15, password = null) {
        // Delegate to the external function
        return ComputeOps.computeHierarchy(this, holon, lens, options, maxLevels, password);
    }

    /**
     * Computes operations on content within a holon and lens for one layer up.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens to compute.
     * @param {object} options - Computation options
     * @param {string} options.operation - The operation to perform ('summarize', 'aggregate', 'concatenate')
     * @param {string[]} [options.fields] - Fields to perform operation on
     * @param {string} [options.targetField] - Field to store the result in
     * @param {string} [password] - Optional password for private holons
     * @throws {Error} If parameters are invalid or missing
     */
    async compute(holon, lens, options, password = null) {
        // Delegate to the external function
        return ComputeOps.compute(this, holon, lens, options, password);
    }

    /**
     * Summarizes provided history text using OpenAI.
     * @param {string} history - The history text to summarize.
     * @returns {Promise<string>} - The summarized text.
     */
    async summarize(history) {
        // Delegate to the external function
        return ComputeOps.summarize(this, history);
    }

    /**
     * Upcasts content to parent holonagons recursively using references.
     * @param {string} holon - The current holon identifier.
     * @param {string} lens - The lens under which to upcast.
     * @param {object} content - The content to upcast.
     * @param {number} [maxLevels=15] - Maximum levels to upcast.
     * @returns {Promise<object>} - The original content.
     */
    async upcast(holon, lens, content, maxLevels = 15) {
        // Delegate to the external function
        return ComputeOps.upcast(this, holon, lens, content, maxLevels);
    }

    /**
     * Updates the parent holon with a new report.
     * @param {string} id - The child holon identifier.
     * @param {string} report - The report to update.
     * @returns {Promise<object>} - The updated parent information.
     */
    async updateParent(id, report) {
        // Delegate to the external function
        return ComputeOps.updateParent(this, id, report);
    }

    /**
     * Propagates data to federated holons
     * @param {string} holon - The holon identifier
     * @param {string} lens - The lens identifier
     * @param {object} data - The data to propagate
     * @param {object} [options] - Propagation options
     * @returns {Promise<object>} - Result with success count and errors
     */
    async propagate(holon, lens, data, options = {}) {
        return Federation.propagate(this, holon, lens, data, options);
    }

    /**
     * Converts latitude and longitude to a holon identifier.
     * @param {number} lat - The latitude.
     * @param {number} lng - The longitude.
     * @param {number} resolution - The resolution level.
     * @returns {Promise<string>} - The resulting holon identifier.
     */
    async getHolon(lat, lng, resolution) {
        // Delegate to the external function
        return Utils.getHolon(lat, lng, resolution);
    }

    /**
     * Retrieves all containing holonagons at all scales for given coordinates.
     * @param {number} lat - The latitude.
     * @param {number} lng - The longitude.
     * @returns {Array<string>} - List of holon identifiers.
     */
    getScalespace(lat, lng) {
        // Delegate to the external function
        return Utils.getScalespace(lat, lng);
    }

    /**
     * Retrieves all containing holonagons at all scales for a given holon.
     * @param {string} holon - The holon identifier.
     * @returns {Array<string>} - List of holon identifiers.
     */
    getHolonScalespace(holon) {
        // Delegate to the external function
        return Utils.getHolonScalespace(holon);
    }

    /**
     * Subscribes to changes in a specific holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens to subscribe to.
     * @param {function} callback - The callback to execute on changes.
     * @returns {Promise<object>} - Subscription object with unsubscribe method
     */
    async subscribe(holon, lens, callback) {
        // Delegate to the external function
        return Utils.subscribe(this, holon, lens, callback);
    }

    /**
     * Notifies subscribers about data changes
     * @param {object} data - The data to notify about
     * @private
     */
    notifySubscribers(data) {
        // Delegate to the external function
        return Utils.notifySubscribers(this, data);
    }

    // Add ID generation method
    generateId() {
        // Delegate to the external function
        return Utils.generateId();
    }

    // ================================ FEDERATION FUNCTIONS ================================

    /**
     * Creates a federation relationship between two holons
     * @param {string} holonId1 - The first holon ID
     * @param {string} holonId2 - The second holon ID
     * @param {string} [password1] - Optional password for the first holon
     * @param {string} [password2] - Optional password for the second holon
     * @param {boolean} [bidirectional=true] - Whether to set up bidirectional notifications automatically
     * @param {object} [lensConfig] - Optional lens-specific configuration
     * @param {string[]} [lensConfig.federate] - List of lenses to federate (default: all)
     * @param {string[]} [lensConfig.notify] - List of lenses to notify (default: all)
     * @returns {Promise<boolean>} - True if federation was created successfully
     */
    async federate(holonId1, holonId2, password1 = null, password2 = null, bidirectional = true, lensConfig = {}) {
        return Federation.federate(this, holonId1, holonId2, password1, password2, bidirectional, lensConfig);
    }

    /**
     * Subscribes to federation notifications for a holon
     * @param {string} holonId - The holon ID to subscribe to
     * @param {string} password - Password for the holon
     * @param {function} callback - The callback to execute on notifications
     * @param {object} [options] - Subscription options
     * @param {string[]} [options.lenses] - Specific lenses to subscribe to (default: all)
     * @param {number} [options.throttle] - Throttle notifications in ms (default: 0)
     * @returns {Promise<object>} - Subscription object with unsubscribe() method
     */
    async subscribeFederation(holonId, password, callback, options = {}) {
        return Federation.subscribeFederation(this, holonId, password, callback, options);
    }

    /**
     * Gets federation info for a holon
     * @param {string} holonId - The holon ID
     * @param {string} [password] - Optional password for the holon
     * @returns {Promise<object|null>} - Federation info or null if not found
     */
    async getFederation(holonId, password = null) {
        return Federation.getFederation(this, holonId, password);
    }
  
    /**
     * Retrieves the lens-specific configuration for a federation link between two holons.
     * @param {string} holonId - The ID of the source holon.
     * @param {string} targetHolonId - The ID of the target holon in the federation link.
     * @param {string} [password] - Optional password for the source holon.
     * @returns {Promise<object|null>} - An object with 'federate' and 'notify' arrays, or null if not found.
     */
    async getFederatedConfig(holonId, targetHolonId, password = null) {
        return Federation.getFederatedConfig(this, holonId, targetHolonId, password);
    }

    /**
     * Removes a federation relationship between holons
     * @param {string} holonId1 - The first holon ID
     * @param {string} holonId2 - The second holon ID
     * @param {string} password1 - Password for the first holon
     * @param {string} [password2] - Optional password for the second holon
     * @returns {Promise<boolean>} - True if federation was removed successfully
     */
    async unfederate(holonId1, holonId2, password1, password2 = null) {
        return await Federation.unfederate(this, holonId1, holonId2, password1, password2);
    }

    /**
     * Removes a notification relationship between two spaces
     * This removes spaceId2 from the notify list of spaceId1
     * 
     * @param {string} holonId1 - The space to modify (remove from its notify list)
     * @param {string} holonId2 - The space to be removed from notifications
     * @param {string} [password1] - Optional password for the first space
     * @returns {Promise<boolean>} - True if notification was removed successfully
     */
    async removeNotify(holonId1, holonId2, password1 = null) {
        console.log(`HoloSphere.removeNotify called: ${holonId1}, ${holonId2}`);
        try {
            const result = await Federation.removeNotify(this, holonId1, holonId2, password1);
            console.log(`HoloSphere.removeNotify completed successfully: ${result}`);
            return result;
        } catch (error) {
            console.error(`HoloSphere.removeNotify failed:`, error);
            throw error;
        }
    }

    /**
     * Get and aggregate data from federated holons
     * @param {string} holon The holon name
     * @param {string} lens The lens name
     * @param {Object} options Options for retrieval and aggregation
     * @returns {Promise<Array>} Combined array of local and federated data
     */
    async getFederated(holon, lens, options = {}) {
        return Federation.getFederated(this, holon, lens, options);
    }

    /**
     * Tracks a federated message across different chats
     * @param {string} originalChatId - The ID of the original chat
     * @param {string} messageId - The ID of the original message
     * @param {string} federatedChatId - The ID of the federated chat
     * @param {string} federatedMessageId - The ID of the message in the federated chat
     * @param {string} type - The type of message (e.g., 'quest', 'announcement')
     * @returns {Promise<void>}
     */
    async federateMessage(originalChatId, messageId, federatedChatId, federatedMessageId, type = 'generic') {
        return Federation.federateMessage(this, originalChatId, messageId, federatedChatId, federatedMessageId, type);
    }

    /**
     * Gets all federated messages for a given original message
     * @param {string} originalChatId - The ID of the original chat
     * @param {string} messageId - The ID of the original message
     * @returns {Promise<Object|null>} The tracking information for the message
     */
    async getFederatedMessages(originalChatId, messageId) {
        return Federation.getFederatedMessages(this, originalChatId, messageId);
    }

    /**
     * Updates a federated message across all federated chats
     * @param {string} originalChatId - The ID of the original chat
     * @param {string} messageId - The ID of the original message
     * @param {Function} updateCallback - Function to update the message in each chat
     * @returns {Promise<void>}
     */
    async updateFederatedMessages(originalChatId, messageId, updateCallback) {
        return Federation.updateFederatedMessages(this, originalChatId, messageId, updateCallback);
    }

    /**
     * Resets the federation settings for a holon
     * @param {string} holonId - The holon ID
     * @param {string} [password] - Optional password for the holon
     * @returns {Promise<boolean>} - True if federation was reset successfully
     */
    async resetFederation(holonId, password = null) {
        return Federation.resetFederation(this, holonId, password);
    }

    // ================================ END FEDERATION FUNCTIONS ================================
    /**
     * Closes the HoloSphere instance and cleans up resources.
     * @returns {Promise<void>}
     */
    async close() {
        // Delegate to the external function
        return Utils.close(this);
    }

    /**
     * Creates a namespaced username for Gun authentication
     * @private
     * @param {string} holonId - The holon ID
     * @returns {string} - Namespaced username
     */
    userName(holonId) {
        // Delegate to the external function
        return Utils.userName(this, holonId);
    }

    /**
     * Returns the current version of the HoloSphere library.
     * @returns {string} The library version.
     */
    getVersion() {
        return HOLOSPHERE_VERSION;
    }
}

export default HoloSphere;
