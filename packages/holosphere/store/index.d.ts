// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Store, StoreAdapter } from './store.js';

export * from './store.js';

export type AdapterSpec = 'memory' | 'indexeddb' | 'file' | 'auto' | StoreAdapter;

export interface CreateStoreOptions {
    appName: string;
    adapter?: AdapterSpec;
    /** Directory for the file adapter (default `./holosphere-store`). */
    dir?: string;
    compactAfter?: number;
    /** Legacy envelope kind (default 30078). */
    kind?: number;
    /** Which kinds this store consumes; defaults to the envelope alone. */
    wire?: WireRegistry;
}

/**
 * One address claimed by an event: where the record lives and what it says.
 * An event may make several — a NIP-09 kind 5 retracts every coordinate it
 * names at once.
 */
export interface WireClaim {
    holon: string | null;
    lens: string;
    id: string;
    item: Record<string, unknown>;
}

/** A lens carried on its own standard Nostr kind(s). */
export interface LensWire {
    lens: string;
    /** Kinds this lens claims as its canonical wire. */
    kinds: number[];
    /** Decode an event into the address(es) it claims, or null when not ours. */
    decode(event: any): WireClaim[] | WireClaim | null;
    /** REQ shapes that keep a holon's records in sync. */
    filters?(holon: string): object[];
    /** Resolve a `d` tag back to an address, so a NIP-09 retraction can land. */
    address?(dTag: string): { holon: string; lens: string; id: string } | null;
}

/** Which event kinds a store consumes, and how each decodes to an address. */
export interface WireRegistry {
    legacyKind: number;
    register(wire: LensWire): void;
    wiresFor(lens: string): LensWire[];
    isStandardPrimary(lens: string): boolean;
    kinds(): number[];
    accepts(kind: number): boolean;
    decode(event: any): WireClaim[] | null;
}

export function createWireRegistry(opts?: { legacyKind?: number }): WireRegistry;

export function createStore(opts: CreateStoreOptions): Store;
export function resolveAdapter(spec: AdapterSpec | undefined, opts?: { appName?: string; dir?: string }): StoreAdapter | (() => Promise<StoreAdapter>);

export function createMemoryAdapter(opts?: { retain?: boolean }): StoreAdapter;
export function createIndexedDbAdapter(opts?: { appName?: string; dbName?: string; indexedDB?: IDBFactory }): StoreAdapter & { readonly degraded: boolean };

export function wins(candidate: { created_at: number; eventId?: string }, current?: { created_at: number; eventId?: string } | null): boolean;
export function newestFirst(a: { created_at: number; id?: string; eventId?: string }, b: { created_at: number; id?: string; eventId?: string }): number;

export const GLOBAL_HOLON: '_g';
export const CAPABILITIES_HOLON: '_capabilities';
export function holonKey(holon: string | null | undefined): string;
export function holonFromKey(key: string): string | null;
export function lensKey(holon: string | null | undefined, lens: string): string;
export function addr(holon: string | null | undefined, lens: string, id: string): string;
export function parseLensKey(key: string): { holon: string | null; lens: string };
export function parseAddr(a: string): { holon: string | null; lens: string; id: string } | null;
export function lensKeyOfAddr(a: string): string;
export function soulOf(appName: string, holon: string | null | undefined, lens: string, id: string): string;
export function addrFromSoul(soul: string, appName?: string): string | null;

export namespace privateLens {
    const KDF: { N: number; r: number; p: number; dkLen: number };
    const CHECK_LENS: string;
    const CHECK_KEY: string;
    function privateScope(appName: string, holon: string | null | undefined, lens: string): string;
    function deriveKey(password: string, scope: string): Promise<Uint8Array>;
    function forgetKeys(): void;
    function seal(item: unknown, key: Uint8Array): string;
    function open(payload: string, key: Uint8Array): any;
    function privateKeyOf(scope: string, lens: string, key: string): string;
    function privateLensPrefix(scope: string, lens: string): string;
}
