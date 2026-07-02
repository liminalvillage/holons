/**
 * StorageBackend — pluggable storage layer for HoloSphere.
 *
 * Every backend must implement this interface.  The orchestration layer
 * (content.js, global.js, utils.js) delegates primitive read/write/subscribe
 * operations here and handles higher-level concerns (hologram resolution,
 * federation routing, signing, schema validation) on top.
 */
export interface StorageBackend {
  /** Discriminator so the orchestration layer can branch on backend type. */
  readonly type: 'gun' | 'ad4m';

  // ── Core CRUD ──

  put(
    holon: string | null,
    lens: string,
    key: string,
    payload: string,
    options?: { timeout?: number }
  ): Promise<{ ok: boolean; queued?: boolean }>;

  get(
    holon: string | null,
    lens: string,
    key: string,
    options?: { timeout?: number; awaitNetwork?: boolean }
  ): Promise<string | null>;

  getAll(
    holon: string | null,
    lens: string,
    options?: { timeout?: number }
  ): Promise<Map<string, string>>;

  delete(
    holon: string | null,
    lens: string,
    key: string
  ): Promise<boolean>;

  // ── Subscriptions ──

  subscribe(
    holon: string | null,
    lens: string,
    callback: (key: string, value: string | null) => void,
    options?: { includeDeletes?: boolean }
  ): { unsubscribe: () => void };

  // ── Node references (hologram tracking) ──

  getNodeRef(soul: string): NodeRef;

  // ── Lifecycle ──

  ready(): Promise<void>;
  close(): Promise<void>;
}

export interface NodeRef {
  get(path: string): NodeRef;
  put(value: any, callback?: (ack: { err?: string }) => void): void;
  once(callback: (data: any) => void): void;
  off?(): void;
}
