/**
 * UI-agnostic factory for `HoloSphere` instances.
 *
 * Both UIs (web + telegram bot) used to build `HoloSphere` independently with
 * subtly different code paths. This module is the single place where the
 * constructor is invoked; UI wrappers add only environment-specific concerns
 * (svelte stores, Node key files, etc.).
 *
 * The factory deliberately does NOT touch `process.env`, `localStorage`, or
 * filesystem — callers must resolve their own private key. That keeps the
 * core importable from any runtime (browser, Node, edge).
 */

import { HoloSphere } from 'holosphere';

/**
 * Configuration for {@link createHoloSphere}. Mirrors the subset of
 * `HoloSphereConfig` both UIs care about, plus an `awaitReady` flag.
 *
 * Anything not modelled here can be passed through `extra` — useful for
 * Nostr-specific keys like `nostr: { relays, peers, persistence }`.
 */
export interface CreateHoloSphereOptions {
  /** Application namespace (e.g. `"Holons"`, `"HolonsDebug"`). */
  appName: string;
  /** Private key as hex string or raw bytes. Resolved by the caller. */
  privateKey?: Uint8Array | string | null;
  /** Backend selector — `'gun'` (default) or `'ad4m'`. */
  backend?: 'gun' | 'ad4m';
  /** AD4M backend config (only used when backend is `'ad4m'`). */
  ad4m?: {
    /** AD4M executor WebSocket URL. Defaults to `ws://localhost:12000/graphql`. */
    url?: string;
    /** Authentication token for the AD4M executor. */
    token?: string;
    /** Pre-loaded schema map (lens name → JSON Schema object). */
    schemas?: Map<string, object>;
    /** Path to directory containing JSON Schema files. */
    schemaDir?: string;
  };
  /** Holosphere log level (`'INFO'`, `'DEBUG'`, ...). */
  logLevel?: string;
  /** Strict-mode toggle for holosphere. */
  strict?: boolean;
  /** When true, await `holosphere.ready()` before returning. */
  awaitReady?: boolean;
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
export function createHoloSphere(options: CreateHoloSphereOptions): HoloSphere;
export function createHoloSphere(
  options: CreateHoloSphereOptions & { awaitReady: true }
): Promise<HoloSphere>;
export function createHoloSphere(
  options: CreateHoloSphereOptions
): HoloSphere | Promise<HoloSphere> {
  const { appName, privateKey, backend, ad4m, logLevel, strict, awaitReady, extra } = options;

  const config: Record<string, unknown> = {
    appName,
    ...(privateKey !== undefined ? { privateKey } : {}),
    ...(backend ? { backend } : {}),
    ...(ad4m ? { ad4m } : {}),
    ...(logLevel ? { logLevel } : {}),
    ...(strict !== undefined ? { strict } : {}),
    ...(extra ?? {}),
  };

  const instance = new HoloSphere(config as any);
  return awaitReady ? instance.ready().then(() => instance) : instance;
}
