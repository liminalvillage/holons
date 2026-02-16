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

import { Ad4mClient, PerspectiveProxy } from '@coasys/ad4m';

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
}

/** Represents the current connection state */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'authenticated'
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
 *
 * Usage:
 * ```typescript
 * const conn = new Ad4mConnection({
 *   executorUrl: 'ws://localhost:12000/graphql',
 *   token: 'your-jwt-token'
 * });
 * await conn.connect();
 * const perspective = await conn.getPerspective(perspectiveUuid);
 * ```
 *
 * TODO: Test with a real AD4M executor to verify Apollo Client setup.
 * The actual Apollo Client construction may need adjustment based on
 * the executor's GraphQL schema version.
 */
export class Ad4mConnection {
  private config: Ad4mConnectionConfig;
  private client: Ad4mClient | null = null;
  private state: ConnectionState = 'disconnected';
  private stateCallbacks: Set<ConnectionStateCallback> = new Set();
  private perspectiveCache: Map<string, PerspectiveProxy> = new Map();

  constructor(config: Ad4mConnectionConfig) {
    this.config = {
      subscribe: true,
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
   * This establishes a WebSocket connection and creates the Ad4mClient.
   * If a token is provided, it will be used for authentication.
   *
   * TODO: This uses dynamic imports for Apollo Client to avoid bundling issues.
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
      // Dynamic import to avoid bundling issues in SvelteKit
      // These are peer dependencies that must be installed separately
      const { ApolloClient, InMemoryCache } = await import('@apollo/client/core');
      const { GraphQLWsLink } = await import('@apollo/client/link/subscriptions');
      const { createClient } = await import('graphql-ws');

      // Build WebSocket URL with optional token
      const url = new URL(this.config.executorUrl);
      if (this.config.token) {
        url.searchParams.set('token', this.config.token);
      }

      // Create GraphQL WebSocket client
      const wsClient = createClient({
        url: url.toString(),
        // TODO: Add reconnect logic for production use
        // retryAttempts: 5,
        // connectionParams: { token: this.config.token },
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
   * Disconnect from the AD4M executor.
   * Clears the client and perspective cache.
   */
  async disconnect(): Promise<void> {
    this.perspectiveCache.clear();
    this.client = null;
    this.setState('disconnected');
  }

  /**
   * Get a PerspectiveProxy for a given perspective UUID.
   * Caches perspectives to avoid redundant lookups.
   *
   * @param uuid - The perspective UUID (maps to a Holon ID in our system)
   * @returns PerspectiveProxy for interacting with the perspective
   * @throws Error if not connected
   *
   * TODO: Test with real executor — perspective.byUUID() may need
   * the perspective to exist already. For new holons, we'll need
   * to create the perspective first.
   */
  async getPerspective(uuid: string): Promise<PerspectiveProxy> {
    if (!this.client) {
      throw new Error('Not connected to AD4M executor. Call connect() first.');
    }

    if (this.perspectiveCache.has(uuid)) {
      return this.perspectiveCache.get(uuid)!;
    }

    const perspective = await this.client.perspective.byUUID(uuid);
    if (!perspective) {
      throw new Error(`Perspective not found: ${uuid}`);
    }

    this.perspectiveCache.set(uuid, perspective);
    return perspective;
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
   * Publish a local Perspective as a shared Neighbourhood.
   *
   * This makes a private holon accessible to other agents via Holochain DHT.
   *
   * @param perspectiveUuid - UUID of the local perspective to share
   * @param linkLanguageAddress - Address of the Link Language to use for sync
   * @returns The Neighbourhood URL
   * @throws Error if not connected
   *
   * TODO: Determine the correct Link Language address to use.
   * This depends on which Link Languages are installed in the executor.
   */
  async publishNeighbourhood(
    perspectiveUuid: string,
    linkLanguageAddress: string
  ): Promise<string> {
    if (!this.client) {
      throw new Error('Not connected to AD4M executor. Call connect() first.');
    }

    // Import the necessary types
    const { Perspective } = await import('@coasys/ad4m');

    // publishFromPerspective takes (perspectiveUUID, linkLanguageAddress, meta: Perspective)
    // The meta Perspective can contain links with metadata about the neighbourhood
    const meta = new Perspective();

    const neighbourhoodUrl = await this.client.neighbourhood.publishFromPerspective(
      perspectiveUuid,
      linkLanguageAddress,
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
