/**
 * AD4M Executor Connection Management
 *
 * Handles connecting to both local and remote AD4M executors.
 * Uses @coasys/ad4m's Ad4mClient which wraps Apollo Client for GraphQL
 * communication with the executor's Juniper-based API.
 *
 * Connection modes:
 * 1. Local executor — connects to ws://localhost:12000/graphql (default AD4M port)
 * 2. Remote executor — connects to a remote URL like wss://lucksus.ad4m.dev:12001/graphql
 *
 * Authentication:
 * AD4M uses capability-based auth. The @coasys/ad4m-connect library provides a UI
 * for authenticating with the executor. For programmatic use, you can pass a pre-obtained
 * JWT token.
 *
 * @module ad4m/connection
 */

import { Ad4mClient, PerspectiveProxy, Perspective, Literal } from '@coasys/ad4m';
import { ApolloClient, InMemoryCache } from '@apollo/client/core';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';

/** Configuration for connecting to an AD4M executor */
export interface Ad4mConnectionConfig {
  /**
   * WebSocket URL of the AD4M executor's GraphQL endpoint.
   * Examples:
   *   - Local: "ws://localhost:12000/graphql"
   *   - Remote: "wss://lucksus.ad4m.dev:12001/graphql"
   */
  executorUrl: string;

  /**
   * JWT authentication token obtained from the AD4M executor.
   * Required for authenticated operations. Can be obtained via:
   * - @coasys/ad4m-connect UI flow
   * - CLI: `ad4m-cli agent lock/unlock`
   * - Programmatic: Runtime capability request
   */
  token?: string;

  /**
   * Whether to set up GraphQL subscriptions for real-time updates.
   * Default: true. Set to false for read-only/one-shot operations.
   */
  subscribe?: boolean;

  /**
   * Maximum number of reconnection attempts before giving up.
   * Default: 5. Set to 0 to disable reconnection.
   */
  retryAttempts?: number;

  /**
   * Base delay in milliseconds between reconnection attempts.
   * Actual delay uses exponential backoff: retryDelayMs * 2^attempt.
   * Default: 1000 (1 second).
   */
  retryDelayMs?: number;
}

/** Represents the current connection state */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'authenticated'
  | 'reconnecting'
  | 'error';

/** Connection state change callback */
export type ConnectionStateCallback = (state: ConnectionState, error?: Error) => void;

/**
 * Manages the connection to an AD4M executor.
 *
 * This class wraps the process of:
 * 1. Creating an Apollo Client with WebSocket link
 * 2. Building an Ad4mClient from it
 * 3. Authenticating with the executor
 * 4. Providing access to PerspectiveProxy instances
 * 5. Reconnecting with exponential backoff on connection loss
 *
 * Usage:
 * ```typescript
 * const conn = new Ad4mConnection({
 *   executorUrl: 'ws://localhost:12000/graphql',
 *   token: 'your-jwt-token',
 *   retryAttempts: 5,
 *   retryDelayMs: 1000,
 * });
 * await conn.connect();
 * const perspective = await conn.getPerspective(perspectiveUuid);
 * ```
 *
 * NOTE: The Apollo Client construction may need adjustment based on the
 * executor's GraphQL schema version. Test with a real executor to verify.
 */
export class Ad4mConnection {
  private config: Ad4mConnectionConfig;
  private client: Ad4mClient | null = null;
  private state: ConnectionState = 'disconnected';
  private stateCallbacks: Set<ConnectionStateCallback> = new Set();
  private perspectiveCache: Map<string, PerspectiveProxy> = new Map();
  private activeSubscriptions: Array<{ perspectiveUuid: string; callback: () => void }> = [];

  constructor(config: Ad4mConnectionConfig) {
    this.config = {
      subscribe: true,
      retryAttempts: 5,
      retryDelayMs: 1000,
      ...config,
    };
  }

  /** Get the current connection state */
  get connectionState(): ConnectionState {
    return this.state;
  }

  /** Get the underlying Ad4mClient (null if not connected) */
  get ad4mClient(): Ad4mClient | null {
    return this.client;
  }

  /** Whether we have an active, authenticated connection */
  get isConnected(): boolean {
    return this.state === 'authenticated' || this.state === 'connected';
  }

  /** Register a callback for connection state changes */
  onStateChange(callback: ConnectionStateCallback): () => void {
    this.stateCallbacks.add(callback);
    return () => this.stateCallbacks.delete(callback);
  }

  private setState(state: ConnectionState, error?: Error) {
    this.state = state;
    for (const cb of this.stateCallbacks) {
      try {
        cb(state, error);
      } catch (e) {
        console.error('[Ad4mConnection] State callback error:', e);
      }
    }
  }

  /**
   * Connect to the AD4M executor.
   *
   * Establishes a WebSocket connection with automatic reconnection via
   * graphql-ws's built-in retry mechanism with exponential backoff.
   * On reconnection, the perspective cache is invalidated and subscriptions
   * are re-established.
   *
   * NOTE: Uses dynamic imports for Apollo Client to avoid bundling issues.
   * The exact Apollo Client setup depends on the runtime environment (browser vs Node).
   * With a real AD4M executor, you may need to use @coasys/ad4m-connect for the
   * full auth flow instead of manual Apollo Client construction.
   *
   * @throws Error if connection fails
   */
  async connect(): Promise<Ad4mClient> {
    if (this.client && this.isConnected) {
      return this.client;
    }

    this.setState('connecting');

    try {
      // Build WebSocket URL with optional token
      const url = new URL(this.config.executorUrl);
      if (this.config.token) {
        url.searchParams.set('token', this.config.token);
      }

      const retryAttempts = this.config.retryAttempts ?? 5;
      const retryDelayMs = this.config.retryDelayMs ?? 1000;

      // Create GraphQL WebSocket client with reconnection
      const wsClient = createClient({
        url: url.toString(),
        retryAttempts,
        retryWait: async (retryCount: number) => {
          // Exponential backoff: baseDelay * 2^retryCount, capped at 30s
          const delay = Math.min(retryDelayMs * Math.pow(2, retryCount), 30000);
          console.log(`[Ad4mConnection] Reconnecting in ${delay}ms (attempt ${retryCount + 1}/${retryAttempts})`);
          this.setState('reconnecting');
          await new Promise(resolve => setTimeout(resolve, delay));
        },
        on: {
          connected: () => {
            // On reconnection, invalidate perspective cache and re-establish subscriptions
            if (this.state === 'reconnecting') {
              console.log('[Ad4mConnection] Reconnected — re-establishing state');
              this.perspectiveCache.clear();
              this.reEstablishSubscriptions();
            }
          },
          closed: (event: any) => {
            if (this.state !== 'disconnected') {
              console.warn('[Ad4mConnection] WebSocket closed:', event);
            }
          },
          error: (error: any) => {
            console.error('[Ad4mConnection] WebSocket error:', error);
          },
        },
        connectionParams: this.config.token ? { token: this.config.token } : undefined,
      });

      // Create Apollo link from WebSocket client
      const wsLink = new GraphQLWsLink(wsClient);

      // Create Apollo Client
      const apolloClient = new ApolloClient({
        link: wsLink,
        cache: new InMemoryCache(),
        defaultOptions: {
          watchQuery: { fetchPolicy: 'no-cache' },
          query: { fetchPolicy: 'no-cache' },
        },
      });

      // Create AD4M Client
      this.client = new Ad4mClient(apolloClient as any, this.config.subscribe ?? true);

      this.setState('connected');

      // Verify authentication by checking agent status
      if (this.config.token) {
        try {
          const agentStatus = await this.client.agent.status();
          if (agentStatus.isInitialized) {
            this.setState('authenticated');
          }
        } catch (authErr) {
          console.warn('[Ad4mConnection] Agent status check failed (may need auth):', authErr);
          // Still connected, just not authenticated
        }
      }

      return this.client;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.setState('error', err);
      throw err;
    }
  }

  /**
   * Re-establish subscriptions after a reconnection.
   * Called automatically when the WebSocket reconnects.
   */
  private reEstablishSubscriptions(): void {
    for (const sub of this.activeSubscriptions) {
      try {
        sub.callback();
      } catch (e) {
        console.error(`[Ad4mConnection] Failed to re-establish subscription for ${sub.perspectiveUuid}:`, e);
      }
    }
    // Update state after re-establishing
    if (this.config.token) {
      this.setState('authenticated');
    } else {
      this.setState('connected');
    }
  }

  /**
   * Register a subscription re-establishment callback.
   * Called by the adapter layer to ensure subscriptions survive reconnects.
   *
   * @param perspectiveUuid - The perspective this subscription belongs to
   * @param callback - Function to call to re-establish the subscription
   * @returns Unregister function
   */
  registerSubscription(perspectiveUuid: string, callback: () => void): () => void {
    const entry = { perspectiveUuid, callback };
    this.activeSubscriptions.push(entry);
    return () => {
      const idx = this.activeSubscriptions.indexOf(entry);
      if (idx >= 0) this.activeSubscriptions.splice(idx, 1);
    };
  }

  /**
   * Disconnect from the AD4M executor.
   * Clears the client and perspective cache.
   */
  async disconnect(): Promise<void> {
    this.perspectiveCache.clear();
    this.activeSubscriptions = [];
    this.client = null;
    this.setState('disconnected');
  }

  /**
   * Get a PerspectiveProxy for a given perspective UUID.
   * Caches perspectives to avoid redundant lookups.
   *
   * @param uuid - The perspective UUID (maps to a Holon ID in our system)
   * @param options - Optional settings
   * @param options.createIfMissing - If true, creates the perspective when not found
   * @param options.name - Name to use when creating a missing perspective
   * @returns PerspectiveProxy for interacting with the perspective
   * @throws Error if not connected or perspective not found (when createIfMissing is false)
   */
  async getPerspective(
    uuid: string,
    options?: { createIfMissing?: boolean; name?: string }
  ): Promise<PerspectiveProxy> {
    if (!this.client) {
      throw new Error('Not connected to AD4M executor. Call connect() first.');
    }

    if (this.perspectiveCache.has(uuid)) {
      return this.perspectiveCache.get(uuid)!;
    }

    const perspective = await this.client.perspective.byUUID(uuid);
    if (!perspective) {
      if (options?.createIfMissing) {
        return this.createPerspective(options.name || uuid);
      }
      throw new Error(`Perspective not found: ${uuid}`);
    }

    this.perspectiveCache.set(uuid, perspective);
    return perspective;
  }

  /**
   * Get an existing perspective or create it if it doesn't exist.
   *
   * Convenience method that combines getPerspective() with createPerspective().
   * Useful for ensuring a perspective exists for a given holon ID.
   *
   * @param uuid - The perspective UUID to look for
   * @param name - Name to use if creating a new perspective (defaults to uuid)
   * @returns PerspectiveProxy for the existing or newly created perspective
   * @throws Error if not connected
   */
  async getOrCreatePerspective(uuid: string, name?: string): Promise<PerspectiveProxy> {
    return this.getPerspective(uuid, { createIfMissing: true, name: name || uuid });
  }

  /**
   * Create a new local Perspective (private holon).
   *
   * @param name - Human-readable name for the perspective
   * @returns The created PerspectiveProxy
   * @throws Error if not connected
   */
  async createPerspective(name: string): Promise<PerspectiveProxy> {
    if (!this.client) {
      throw new Error('Not connected to AD4M executor. Call connect() first.');
    }

    const perspective = await this.client.perspective.add(name);
    this.perspectiveCache.set(perspective.uuid, perspective);
    return perspective;
  }

  /**
   * Get all installed languages from the executor, filtered to link languages.
   *
   * Link languages handle synchronisation of links between agents in a neighbourhood.
   * They are identified by having "link" or "linksAdapter" in their name or description.
   *
   * @returns Array of language objects with address and name
   * @throws Error if not connected
   */
  async getInstalledLinkLanguages(): Promise<Array<{ address: string; name: string }>> {
    if (!this.client) {
      throw new Error('Not connected to AD4M executor. Call connect() first.');
    }

    const allLanguages = await this.client.languages.byFilter('');
    // Filter to link languages by name/description heuristic
    return allLanguages
      .filter((lang: any) => {
        const name = (lang.name || '').toLowerCase();
        return name.includes('link') || name.includes('links-adapter') || name.includes('linksadapter');
      })
      .map((lang: any) => ({
        address: lang.address,
        name: lang.name,
      }));
  }

  /**
   * Get the default (first suitable) link language for neighbourhood publishing.
   *
   * @returns The address of the first available link language
   * @throws Error if not connected or no link languages are installed
   */
  async getDefaultLinkLanguage(): Promise<string> {
    const linkLanguages = await this.getInstalledLinkLanguages();
    if (linkLanguages.length === 0) {
      throw new Error(
        'No link languages installed in the executor. Install a link language before publishing neighbourhoods.'
      );
    }
    return linkLanguages[0].address;
  }

  /**
   * Publish a local Perspective as a shared Neighbourhood.
   *
   * This makes a private holon accessible to other agents via Holochain DHT.
   * If no linkLanguageAddress is provided, the default installed link language
   * is used automatically.
   *
   * @param perspectiveUuid - UUID of the local perspective to share
   * @param linkLanguageAddress - Address of the Link Language to use for sync (auto-detected if omitted)
   * @returns The Neighbourhood URL
   * @throws Error if not connected or no link language is available
   */
  async publishNeighbourhood(
    perspectiveUuid: string,
    linkLanguageAddress?: string
  ): Promise<string> {
    if (!this.client) {
      throw new Error('Not connected to AD4M executor. Call connect() first.');
    }

    // Auto-select link language if not provided
    const resolvedAddress = linkLanguageAddress || await this.getDefaultLinkLanguage();

    // publishFromPerspective takes (perspectiveUUID, linkLanguageAddress, meta: Perspective)
    // The meta Perspective can contain links with metadata about the neighbourhood
    const meta = new Perspective();

    const neighbourhoodUrl = await this.client.neighbourhood.publishFromPerspective(
      perspectiveUuid,
      resolvedAddress,
      meta
    );

    return neighbourhoodUrl;
  }

  /**
   * Join an existing Neighbourhood (shared holon).
   *
   * @param neighbourhoodUrl - URL of the Neighbourhood to join
   * @returns PerspectiveProxy for the joined neighbourhood
   * @throws Error if not connected
   *
   * NOTE: neighbourhood.joinFromUrl() returns a PerspectiveHandle, not PerspectiveProxy.
   * We use perspective.byUUID() to get the proxy after joining.
   */
  async joinNeighbourhood(neighbourhoodUrl: string): Promise<PerspectiveProxy> {
    if (!this.client) {
      throw new Error('Not connected to AD4M executor. Call connect() first.');
    }

    const handle = await this.client.neighbourhood.joinFromUrl(neighbourhoodUrl);
    // joinFromUrl returns a PerspectiveHandle — we need the PerspectiveProxy
    const perspective = await this.client.perspective.byUUID(handle.uuid);
    if (!perspective) {
      throw new Error(`Failed to get perspective after joining neighbourhood: ${neighbourhoodUrl}`);
    }
    this.perspectiveCache.set(perspective.uuid, perspective);
    return perspective;
  }

  /**
   * Get all perspectives (both local and shared) from the executor.
   *
   * @returns Array of PerspectiveProxy instances
   * @throws Error if not connected
   */
  async getAllPerspectives(): Promise<PerspectiveProxy[]> {
    if (!this.client) {
      throw new Error('Not connected to AD4M executor. Call connect() first.');
    }

    const perspectives = await this.client.perspective.all();
    // Update cache
    for (const p of perspectives) {
      this.perspectiveCache.set(p.uuid, p);
    }
    return perspectives;
  }

  /**
   * Get the current agent's DID.
   *
   * @returns The agent's DID string (e.g., "did:key:z6Mk...")
   * @throws Error if not connected
   */
  async getAgentDid(): Promise<string> {
    if (!this.client) {
      throw new Error('Not connected to AD4M executor. Call connect() first.');
    }

    const status = await this.client.agent.status();
    return status.did!;
  }

  /**
   * Share a neighbourhood URL with another agent by creating a link
   * in a shared perspective.
   *
   * This is a low-level helper. For higher-level holon sharing,
   * use AgentHolonIndex.shareHolon() instead.
   *
   * @param sharedPerspectiveUuid - UUID of a perspective both agents can access
   * @param neighbourhoodUrl - The neighbourhood URL to share
   * @param label - Human-readable label for the shared link
   * @returns The created link
   */
  async shareNeighbourhoodUrl(
    sharedPerspectiveUuid: string,
    neighbourhoodUrl: string,
    label: string = ''
  ): Promise<any> {
    if (!this.client) {
      throw new Error('Not connected to AD4M executor. Call connect() first.');
    }

    const perspective = await this.getPerspective(sharedPerspectiveUuid);
    return perspective.add({
      source: 'ad4m://self',
      predicate: 'holons://shared/neighbourhoodUrl',
      target: neighbourhoodUrl,
    });
  }
}

// =============================================================================
// Convenience factory functions
// =============================================================================

/** Default local executor URL */
export const LOCAL_EXECUTOR_URL = 'ws://localhost:12000/graphql';

/** Known remote executor URL (WorldWiseWeb community) */
export const REMOTE_EXECUTOR_URL = 'wss://lucksus.ad4m.dev:12001/graphql';

/**
 * Create a connection to a local AD4M executor.
 *
 * @param token - Optional JWT auth token
 */
export function connectLocal(token?: string): Ad4mConnection {
  return new Ad4mConnection({
    executorUrl: LOCAL_EXECUTOR_URL,
    token,
  });
}

/**
 * Create a connection to the remote WorldWiseWeb AD4M executor.
 *
 * @param token - JWT auth token (required for remote)
 */
export function connectRemote(token: string): Ad4mConnection {
  return new Ad4mConnection({
    executorUrl: REMOTE_EXECUTOR_URL,
    token,
  });
}
