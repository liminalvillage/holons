// SPDX-License-Identifier: AGPL-3.0-or-later

export interface NostrEvent {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
}

export type RecordOrigin = 'local' | 'remote' | 'raw' | 'import';

export interface StoreRecord<T = any> {
    addr: string;
    holon: string | null;
    lens: string;
    id: string;
    item: T;
    created_at: number;
    pubkey: string | null;
    eventId: string;
    origin: RecordOrigin;
}

export interface Cursor {
    since: number;
    syncedAt: number;
}

export type StoreOp =
    | { t: 'rec'; v: StoreRecord }
    | { t: 'evt'; v: NostrEvent }
    | { t: 'evt-del'; id: string }
    | { t: 'priv'; k: string; v: string }
    | { t: 'priv-del'; k: string }
    | { t: 'cur'; k: string; v: Cursor };

export interface StoreSnapshot {
    records: StoreRecord[];
    events: NostrEvent[];
    private: [string, string][];
    cursors: [string, Cursor][];
}

export interface StoreAdapter {
    kind?: string;
    open(): Promise<StoreSnapshot | null>;
    append(ops: StoreOp[]): Promise<void>;
    snapshot(full: StoreSnapshot): Promise<void>;
    clear(): Promise<void>;
    close(): Promise<void>;
}

export interface WatchMeta {
    tombstone: boolean;
    created_at: number;
    pubkey: string | null;
    eventId: string;
    origin: RecordOrigin;
    replay: boolean;
}

export type WatchCallback<T = any> = (item: T, id: string, meta: WatchMeta) => void;

export type ApplyReason = 'seen' | 'kind' | 'foreign' | 'malformed' | 'invalid' | 'stale';

export interface ApplyResult {
    applied: boolean;
    reason?: ApplyReason;
    record?: StoreRecord;
}

export interface StoreOptions {
    appName: string;
    adapter: StoreAdapter | (() => Promise<StoreAdapter> | StoreAdapter);
    kind?: number;
    compactAfter?: number;
}

export function isTombstone(item: unknown): boolean;
export function decodeEvent(event: NostrEvent): { holon: string | null; lens: string; id: string; item: any } | null;

export class Store {
    constructor(opts: StoreOptions);
    readonly appName: string;
    readonly kind: number;
    adapter: StoreAdapter | null;

    open(): Promise<this>;
    flush(): Promise<void>;
    compact(): Promise<void>;
    clear(): Promise<void>;
    close(): Promise<void>;
    snapshot(): StoreSnapshot;
    stats(): { records: number; events: number; private: number; cursors: number; lenses: number; holons: number; watchers: number; adapter: string | null };

    apply(event: NostrEvent, opts?: { origin?: RecordOrigin; verify?: boolean }): ApplyResult;
    putRaw<T extends object>(holon: string | null, lens: string, id: string, item: T, opts?: { origin?: RecordOrigin }): StoreRecord<T>;
    nextCreatedAt(holon: string | null, lens: string, id: string): number;

    get<T = any>(holon: string | null, lens: string, id: string): StoreRecord<T> | undefined;
    list<T = any>(holon: string | null, lens: string, opts?: { includeDeleted?: boolean }): StoreRecord<T>[];
    listKeys(holon: string | null, lens: string, opts?: { includeDeleted?: boolean }): string[];
    listLenses(holon: string | null): string[];
    listHolons(): string[];
    getEvents(holon: string | null, lens: string, id: string): NostrEvent[];
    listEventIds(holon: string | null, lens: string): string[];
    getBacklinks(soul: string): string[];
    soulOf(holon: string | null, lens: string, id: string): string;

    watch<T = any>(holon: string | null, lens: string, cb: WatchCallback<T>, opts?: { replay?: boolean }): () => void;

    getCursor(holon: string | null, lens: string): Cursor | null;
    setCursor(holon: string | null, lens: string, since: number): Cursor;

    privatePut(scope: string, lens: string, key: string, cipher: string): void;
    privateGet(scope: string, lens: string, key: string): string | undefined;
    privateList(scope: string, lens: string): { key: string; cipher: string }[];
    privateDelete(scope: string, lens: string, key: string): boolean;
    privateClear(scope: string, lens: string): number;

    exportEvents(opts?: { holon?: string | null; lens?: string; authors?: string[] }): NostrEvent[];
    importEvents(events: NostrEvent[], opts?: { origin?: RecordOrigin }): { received: number; applied: number; rejected: number };
}
