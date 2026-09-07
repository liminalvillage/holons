/**
 * UI-agnostic factory for `HoloSphere` instances.
 *
 * Every UI builds its `HoloSphere` here so the constructor is invoked in one
 * place; UI wrappers add only environment-specific concerns (svelte stores,
 * Node key files, etc.).
 *
 * The factory deliberately does NOT touch `process.env`, `localStorage`, or
 * the filesystem — callers resolve their own private key, relays and store
 * location (see `resolveRelays` in `./relays.js`). That keeps the core
 * importable from any runtime (browser, Node, edge).
 *
 * Every write is signed by `privateKey` and published to the relays; there
 * is no signing mode to pick.
 */

import { HoloSphere } from 'holosphere';
import { createWireRegistry } from 'holosphere/store';
import { createShiftWire } from '../shifts/wire.js';
import type { ProjectionHook } from '../nostr/types.js';

/** Where the local store persists (see holosphere/STORE.md). */
export interface HoloSphereStoreOptions {
  /**
   * `'memory'` (default outside a browser; serverless functions, scripts),
   * `'indexeddb'` (default in a browser), `'file'` (long-lived Node hosts),
   * or `'auto'`.
   */
  adapter?: 'memory' | 'indexeddb' | 'file' | 'auto';
  /** Directory for the file adapter. */
  dir?: string;
  compactAfter?: number;
  /** Pre-built wire registry. Usually set for you by `standardWires`. */
  wire?: unknown;
}

/**
 * Lenses carried on their OWN standard Nostr kinds instead of the kind-30078
 * envelope, so records another Nostr app publishes are readable as an ordinary
 * lens. Omit this and nothing changes: every lens stays on the envelope.
 */
export interface StandardWireOptions {
  /**
   * NIP-52 community shifts, as published by Elinor. Enables
   * `getAll(holon, 'shifts')` and `getAll(holon, 'shifts_rsvp')`.
   *
   * Set `coordinatorPubkey` in production. Without it any author's occurrences
   * are accepted, which is fine against a relay you control and is not fine on
   * a shared one.
   */
  shifts?: { coordinatorPubkey?: string };
}

/** Relay-side extras: standard-kind projections and their reverse sync. */
export interface HoloSphereNostrOptions {
  syncTimeoutMs?: number;
  pageSize?: number;
  verbose?: boolean;
  projections?: ProjectionHook[];
  signerFor?: (userId: string | number) => string | Uint8Array | null | undefined;
  providerKey?: string | Uint8Array | null;
  reverseSync?: boolean;
  trustedAuthors?: (holon: string) => string[] | Promise<string[]>;
  reverseLookbackSec?: number;
}

/**
 * Configuration for {@link createHoloSphere}.
 */
export interface CreateHoloSphereOptions {
  /** Application namespace (e.g. `"Holons"`, `"HolonsDebug"`). */
  appName: string;
  /** Private key as hex string or raw bytes. Resolved by the caller. */
  privateKey?: Uint8Array | string | null;
  /**
   * Relay URLs — the wire. An instance without relays is local-only
   * (tests, offline tooling). Resolve with `resolveRelays(env)`.
   */
  relays?: string[];
  /** Local store configuration. */
  store?: HoloSphereStoreOptions;
  /** Relay-side extras (projections, sync tuning). */
  nostr?: HoloSphereNostrOptions;
  /** Strict-mode toggle for holosphere. */
  strict?: boolean;
  /** When true, await `holosphere.ready()` before returning. */
  awaitReady?: boolean;
  /** Lenses carried on their own standard Nostr kinds (see {@link StandardWireOptions}). */
  standardWires?: StandardWireOptions;
  /** Forward arbitrary extra keys to `HoloSphereConfig`. */
  extra?: Record<string, unknown>;
}

/**
 * Build (and optionally `ready()`) a `HoloSphere` instance.
 *
 * Returns the instance synchronously when `awaitReady` is omitted/false, and
 * a `Promise<HoloSphere>` when it's true — matching the natural usage in each
 * UI (web awaits, bot uses sync).
 */
export function createHoloSphere(
  options: CreateHoloSphereOptions & { awaitReady: true }
): Promise<HoloSphere>;
export function createHoloSphere(options: CreateHoloSphereOptions): HoloSphere;
export function createHoloSphere(
  options: CreateHoloSphereOptions
): HoloSphere | Promise<HoloSphere> {
  const { appName, privateKey, relays, store, nostr, strict, awaitReady, standardWires, extra } = options;

  // A lens that owns a standard kind needs the store to consume that kind.
  // Built here so no UI has to know the registry exists.
  let storeCfg = store;
  if (standardWires?.shifts) {
    const wire = createWireRegistry();
    wire.register(createShiftWire(standardWires.shifts));
    storeCfg = { ...(store ?? {}), wire };
  }

  const config: Record<string, unknown> = {
    appName,
    ...(privateKey !== undefined ? { privateKey } : {}),
    ...(relays ? { relays } : {}),
    ...(storeCfg ? { store: storeCfg } : {}),
    ...(nostr ? { nostr } : {}),
    ...(strict !== undefined ? { strict } : {}),
    ...(extra ?? {}),
  };

  const instance = new HoloSphere(config as any);
  return awaitReady ? instance.ready().then(() => instance) : instance;
}
