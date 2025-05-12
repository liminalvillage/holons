/**
 * Federation propagation options interface
 */
interface PropagationOptions {
  /** Whether to use holograms instead of duplicating data (default: true) */
  useHolograms?: boolean;
  /** Specific target spaces to propagate to (default: all federated spaces) */
  targetSpaces?: string[];
  /** Password for accessing the source holon (if needed) */
  password?: string | null;
}

/**
 * Put options interface
 */
interface PutOptions {
  /** Whether to automatically propagate to federated spaces (default: false) */
  autoPropagate?: boolean;
  /** Additional options to pass to propagate */
  propagationOptions?: PropagationOptions;
}

/**
 * Get options interface
 */
interface GetOptions {
  /** Whether to automatically resolve holograms (default: true) */
  resolveHolograms?: boolean;
  /** Options passed to the schema validator */
  validationOptions?: object;
}

/**
 * Resolve Hologram options interface
 */
interface ResolveHologramOptions {
  /** Whether to follow nested holograms (default: true) */
  followHolograms?: boolean;
  /** Internal use: Tracks visited souls to prevent loops */
  visited?: Set<string>;
}

/**
 * Represents a Hologram object, typically containing an id and a soul path.
 */
interface Hologram {
  id: string;
  soul: string;
  [key: string]: any; // Allow other properties, e.g., _federation
}

/**
 * Federation info interface
 */
interface FederationInfo {
  /** Identifier of the holon */
  id: string;
  /** Name of the holon */
  name: string;
  /** List of federated space IDs (spaces this holon federates with) */
  federation: string[];
  /** List of spaces to notify about changes */
  notify: string[];
  /** Timestamp of last update */
  timestamp: number;
}

/**
 * Options for federated data retrieval
 */
interface GetFederatedOptions {
  /** Whether to aggregate results by ID */
  aggregate?: boolean;
  /** Field to use as ID */
  idField?: string;
  /** Fields to sum during aggregation */
  sumFields?: string[];
  /** Array fields to concatenate during aggregation */
  concatArrays?: string[];
  /** Whether to remove duplicates in concatenated arrays */
  removeDuplicates?: boolean;
  /** Custom merge function for aggregation */
  mergeStrategy?: (items: any[]) => any;
  /** Whether to include local data */
  includeLocal?: boolean;
  /** Whether to include federated data */
  includeFederated?: boolean;
  /** Whether to resolve federation references */
  resolveReferences?: boolean;
  /** Maximum number of federated spaces to query */
  maxFederatedSpaces?: number;
  /** Timeout in milliseconds for federated queries */
  timeout?: number;
}

/**
 * Results from a propagation operation
 */
interface PropagationResult {
  /** Number of successfully propagated items */
  success: number;
  /** Number of errors encountered */
  errors: number;
  /** Details about errors */
  errorDetails: Array<{ space: string, error: string }>;
  /** Whether any propagation occurred */
  propagated: boolean;
  /** Whether references were used */
  referencesUsed: boolean;
  /** Error message if applicable */
  error?: string;
  /** Information message if applicable */
  message?: string;
}

declare class HoloSphere {
    private appname;
    private strict;
    private validator;
    public gun;
    private sea;
    private openai?;
    private subscriptions;

    /**
     * Initializes a new instance of the HoloSphere class.
     * @param {string} appname - The name of the application.
     * @param {boolean} strict - Whether to enforce strict schema validation.
     * @param {string|null} openaikey - The OpenAI API key.
     * @param {object|null} gunInstance - The Gun instance to use.
     */
    constructor(appname: string, strict?: boolean, openaikey?: string | null, gunInstance?: any);

    /**
     * Gets the Gun instance.
     * @returns {any} - The Gun instance.
     */
    getGun(): any;

    // ================================ SCHEMA FUNCTIONS ================================

    /**
     * Sets the JSON schema for a specific lens.
     * @param {string} lens - The lens identifier.
     * @param {object} schema - The JSON schema to set.
     * @returns {Promise<boolean>} - Resolves when the schema is set.
     */
    setSchema(lens: string, schema: object): Promise<boolean>;

    /**
     * Retrieves the JSON schema for a specific lens.
     * @param {string} lens - The lens identifier.
     * @returns {Promise<object|null>} - The retrieved schema or null if not found.
     */
    getSchema(lens: string): Promise<object | null>;

    // ================================ CONTENT FUNCTIONS ================================

    /**
     * Stores content in the specified holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens under which to store the content.
     * @param {object} data - The data to store.
     * @param {string} [password] - Optional password for private holon.
     * @param {PutOptions} [options] - Additional options
     * @returns {Promise<any>} - Returns result object if successful
     */
    put(holon: string, lens: string, data: object, password?: string | null, options?: PutOptions): Promise<any>;

    /**
     * Retrieves content from the specified holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens from which to retrieve content.
     * @param {string} key - The specific key to retrieve.
     * @param {string} [password] - Optional password for private holon.
     * @param {GetOptions} [options] - Additional options
     * @returns {Promise<any|null>} - The retrieved content or null if not found.
     */
    get(holon: string, lens: string, key: string, password?: string | null, options?: GetOptions): Promise<any | null>;

    /**
     * Retrieves a node directly using its soul path
     * @param {string} soul - The soul path of the node
     * @returns {Promise<any>} - The retrieved node or null if not found.
     */
    getNodeBySoul(soul: string): Promise<any>;

    /**
     * Propagates data to federated holons
     * @param {string} holon - The holon identifier
     * @param {string} lens - The lens identifier
     * @param {object} data - The data to propagate
     * @param {PropagationOptions} [options] - Propagation options
     * @returns {Promise<PropagationResult>} - Result with success count and errors
     */
    propagate(holon: string, lens: string, data: object, options?: PropagationOptions): Promise<PropagationResult>;

    /**
     * Retrieves all content from the specified holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens from which to retrieve content.
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<Array<any>>} - The retrieved content.
     */
    getAll(holon: string, lens: string, password?: string | null): Promise<Array<any>>;

    /**
     * Deletes a specific key from a given holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens from which to delete the key.
     * @param {string} key - The specific key to delete.
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<boolean>} - Returns true if successful
     */
    delete(holon: string, lens: string, key: string, password?: string | null): Promise<boolean>;

    /**
     * Deletes all keys from a given holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens from which to delete all keys.
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<boolean>} - Returns true if successful
     */
    deleteAll(holon: string, lens: string, password?: string | null): Promise<boolean>;

    // ================================ NODE FUNCTIONS ================================

    /**
     * Stores a specific gun node in a given holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens under which to store the node.
     * @param {object} data - The node to store.
     * @returns {Promise<boolean>} - Returns true if successful
     */
    putNode(holon: string, lens: string, data: object): Promise<boolean>;

    /**
     * Retrieves a specific gun node from the specified holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens identifier.
     * @param {string} key - The specific key to retrieve.
     * @returns {Promise<any|null>} - The retrieved node or null if not found.
     */
    getNode(holon: string, lens: string, key: string): Promise<any | null>;

    /**
     * Gets a Gun reference to a node by its soul
     * @param {string} soul - The soul path
     * @returns {any} - A Gun reference to the node
     */
    getNodeRef(soul: string): any;

    /**
     * Deletes a specific gun node from a given holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens identifier.
     * @param {string} key - The key of the node to delete.
     * @returns {Promise<boolean>} - Returns true if successful
     */
    deleteNode(holon: string, lens: string, key: string): Promise<boolean>;

    // ================================ HOLOGRAM FUNCTIONS ================================

    /**
     * Creates a soul hologram object for a data item.
     * @param {string} holon - The holon where the original data is stored.
     * @param {string} lens - The lens where the original data is stored.
     * @param {object} data - The data to create a hologram for. Must have an 'id' field.
     * @returns {Hologram} - A hologram object containing id and soul.
     */
    createHologram(holon: string, lens: string, data: { id: string, [key: string]: any }): Hologram;

    /**
     * Checks if an object is a hologram (has id and soul).
     * @param {any} data - The data to check.
     * @returns {boolean} - True if the object is considered a hologram.
     */
    isHologram(data: any): data is Hologram;

    /**
     * Resolves a hologram to its actual data by following its soul path.
     * @param {Hologram} hologram - The hologram object to resolve.
     * @param {ResolveHologramOptions} [options] - Options for resolution.
     * @returns {Promise<object|null>} - The resolved data, null if not found, or the original hologram in case of loops/errors.
     */
    resolveHologram(hologram: Hologram, options?: ResolveHologramOptions): Promise<object | null>;

    // ================================ GLOBAL FUNCTIONS ================================

    /**
     * Stores data in a global (non-holon-specific) table.
     * @param {string} tableName - The table name to store data in.
     * @param {object} data - The data to store. If it has an 'id' field, it will be used as the key.
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<void>}
     */
    putGlobal(tableName: string, data: object, password?: string | null): Promise<void>;

    /**
     * Retrieves a specific key from a global table.
     * @param {string} tableName - The table name to retrieve from.
     * @param {string} key - The key to retrieve.
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<any|null>} - The parsed data for the key or null if not found.
     */
    getGlobal(tableName: string, key: string, password?: string | null): Promise<any | null>;

    /**
     * Retrieves all data from a global table.
     * @param {string} tableName - The table name to retrieve data from.
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<Array<any>>} - The parsed data from the table as an array.
     */
    getAllGlobal(tableName: string, password?: string | null): Promise<Array<any>>;

    /**
     * Deletes a specific key from a global table.
     * @param {string} tableName - The table name to delete from.
     * @param {string} key - The key to delete.
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<boolean>} - Returns true if successful
     */
    deleteGlobal(tableName: string, key: string, password?: string | null): Promise<boolean>;

    /**
     * Deletes an entire global table.
     * @param {string} tableName - The table name to delete.
     * @param {string} [password] - Optional password for private holon.
     * @returns {Promise<boolean>} - Returns true if successful
     */
    deleteAllGlobal(tableName: string, password?: string | null): Promise<boolean>;

    // ================================ COMPUTE FUNCTIONS ================================

    /**
     * Computes operations across multiple layers up the hierarchy
     * @param {string} holon - Starting holon identifier
     * @param {string} lens - The lens to compute
     * @param {object} options - Computation options
     * @param {number} [maxLevels=15] - Maximum levels to compute up
     * @param {string} [password] - Optional password for private holons
     * @returns {Promise<Array<any>>} - Computation results
     */
    computeHierarchy(holon: string, lens: string, options: object, maxLevels?: number, password?: string | null): Promise<Array<any>>;

    /**
     * Computes operations on content within a holon and lens for one layer up.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens to compute.
     * @param {object|string} options - Computation options or operation name
     * @param {string} [password] - Optional password for private holons
     * @returns {Promise<any>} - Computation result
     */
    compute(holon: string, lens: string, options: object|string, password?: string | null): Promise<any>;

    /**
     * Upcasts content to parent holonagons recursively using federation and soul references.
     * @param {string} holon - The current holon identifier.
     * @param {string} lens - The lens under which to upcast.
     * @param {object} content - The content to upcast.
     * @param {number} [maxLevels=15] - Maximum levels to upcast.
     * @returns {Promise<object>} - The original content.
     */
    upcast(holon: string, lens: string, content: object, maxLevels?: number): Promise<object>;

    /**
     * Updates the parent holon with a new report.
     * @param {string} id - The child holon identifier.
     * @param {string} report - The report to update.
     * @returns {Promise<object>} - The updated parent information.
     */
    updateParent(id: string, report: string): Promise<object>;

    // ================================ LOCATION FUNCTIONS ================================

    /**
     * Converts latitude and longitude to a holon identifier.
     * @param {number} lat - The latitude.
     * @param {number} lng - The longitude.
     * @param {number} resolution - The resolution level.
     * @returns {Promise<string>} - The resulting holon identifier.
     */
    getHolon(lat: number, lng: number, resolution: number): Promise<string>;

    /**
     * Retrieves all containing holonagons at all scales for given coordinates.
     * @param {number} lat - The latitude.
     * @param {number} lng - The longitude.
     * @returns {Array<string>} - List of holon identifiers.
     */
    getScalespace(lat: number, lng: number): string[];

    /**
     * Retrieves all containing holonagons at all scales for a given holon.
     * @param {string} holon - The holon identifier.
     * @returns {Array<string>} - List of holon identifiers.
     */
    getHolonScalespace(holon: string): string[];

    // ================================ SUBSCRIPTION FUNCTIONS ================================

    /**
     * Subscribes to changes in a specific holon and lens.
     * @param {string} holon - The holon identifier.
     * @param {string} lens - The lens to subscribe to.
     * @param {function} callback - The callback to execute on changes.
     * @returns {Promise<object>} - Subscription object with unsubscribe method
     */
    subscribe(holon: string, lens: string, callback: (data: any, key?: string) => void): Promise<{ unsubscribe: () => void }>;

    // ================================ FEDERATION FUNCTIONS ================================

    /**
     * Creates a federation relationship between two holons
     * @param {string} holonId1 - The first holon ID
     * @param {string} holonId2 - The second holon ID
     * @param {string} [password1] - Optional password for the first holon
     * @param {string} [password2] - Optional password for the second holon
     * @param {boolean} [bidirectional=true] - Whether to set up bidirectional notifications automatically
     * @returns {Promise<boolean>} - True if federation was created successfully
     */
    federate(holonId1: string, holonId2: string, password1?: string | null, password2?: string | null, bidirectional?: boolean): Promise<boolean>;

    /**
     * Subscribes to federation notifications for a holon
     * @param {string} holonId - The holon ID to subscribe to
     * @param {string} [password] - Optional password for the holon
     * @param {function} callback - The callback to execute on notifications
     * @param {object} [options] - Subscription options
     * @returns {Promise<object>} - Subscription object with unsubscribe() method
     */
    subscribeFederation(holonId: string, password: string | null, callback: (data: any, federatedSpace?: string, lens?: string) => void, options?: { lenses?: string[], throttle?: number }): Promise<{ unsubscribe: () => void, getSubscriptionCount: () => number }>;

    /**
     * Gets federation info for a holon
     * @param {string} holonId - The holon ID
     * @param {string} [password] - Optional password for the holon
     * @returns {Promise<FederationInfo|null>} - Federation info or null if not found
     */
    getFederation(holonId: string, password?: string | null): Promise<FederationInfo | null>;

    /**
     * Removes a federation relationship between holons
     * @param {string} holonId1 - The first holon ID
     * @param {string} holonId2 - The second holon ID
     * @param {string} [password1] - Optional password for the first holon
     * @param {string} [password2] - Optional password for the second holon
     * @returns {Promise<boolean>} - True if federation was removed successfully
     */
    unfederate(holonId1: string, holonId2: string, password1?: string | null, password2?: string | null): Promise<boolean>;

    /**
     * Removes a notification relationship between two spaces
     * @param {string} holonId1 - The space to modify (remove from its notify list)
     * @param {string} holonId2 - The space to be removed from notifications
     * @param {string} [password1] - Optional password for the first space
     * @returns {Promise<boolean>} - True if notification was removed successfully
     */
    removeNotify(holonId1: string, holonId2: string, password1?: string | null): Promise<boolean>;

    /**
     * Get and aggregate data from federated holons
     * @param {string} holon - The holon name
     * @param {string} lens - The lens name
     * @param {GetFederatedOptions} [options] - Options for retrieval and aggregation
     * @returns {Promise<Array<any>>} - Combined array of local and federated data
     */
    getFederated(holon: string, lens: string, options?: GetFederatedOptions): Promise<Array<any>>;

    /**
     * Tracks a federated message across different chats
     * @param {string} originalChatId - The ID of the original chat
     * @param {string} messageId - The ID of the original message
     * @param {string} federatedChatId - The ID of the federated chat
     * @param {string} federatedMessageId - The ID of the message in the federated chat
     * @param {string} [type] - The type of message (e.g., 'quest', 'announcement')
     * @returns {Promise<void>}
     */
    federateMessage(originalChatId: string, messageId: string, federatedChatId: string, federatedMessageId: string, type?: string): Promise<void>;

    /**
     * Gets all federated messages for a given original message
     * @param {string} originalChatId - The ID of the original chat
     * @param {string} messageId - The ID of the original message
     * @returns {Promise<object|null>} - The tracking information for the message
     */
    getFederatedMessages(originalChatId: string, messageId: string): Promise<object | null>;

    /**
     * Updates a federated message across all federated chats
     * @param {string} originalChatId - The ID of the original chat
     * @param {string} messageId - The ID of the original message
     * @param {Function} updateCallback - Function to update the message in each chat
     * @returns {Promise<void>}
     */
    updateFederatedMessages(originalChatId: string, messageId: string, updateCallback: (chatId: string, messageId: string) => Promise<void>): Promise<void>;

    /**
     * Resets the federation settings for a holon
     * @param {string} holonId - The holon ID
     * @param {string} [password] - Optional password for the holon
     * @returns {Promise<boolean>} - True if federation was reset successfully
     */
    resetFederation(holonId: string, password?: string | null): Promise<boolean>;

    // ================================ UTILITY FUNCTIONS ================================

    /**
     * Generates a unique ID for data items
     * @returns {string} A unique ID
     */
    generateId(): string;

    /**
     * Closes the HoloSphere instance and cleans up resources.
     * @returns {Promise<void>}
     */
    close(): Promise<void>;
}

export default HoloSphere;
