// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// One resolver turns ANY identifier into the name a person would recognise:
// a Telegram id, a hex pubkey or npub, a holon id. It asks the sources in one
// order, caches what it learns, and never answers with a bare id — the
// fallback is `shortId`. Every surface renders through it, so a name means
// the same thing on the kiosk, the web, in the bot and over MCP.
//
// People, in order: the person on screen (`self`), the `users` record in the
// holon being shown, their personal-holon record, the kind-31926 directory
// (a key linked to a Telegram person → that person's record, else the
// attested name), their kind 0 on the relays, the join request they sent.
// Holons: `settings.name` (or `title`; the web's "My Holon" default is no
// name), the HNS table (injected), and whatever the surface `prime`s from
// state it already holds (federation partner names, remembered holons, the
// linked chat's title). A 64-hex id is tried as a person first — a key
// user's personal holon IS that person.

import { attestationIdentityMap, attestationNameMap, parseIdentifier, type IdentityAttestation } from '../shifts/attestation.js';
import { SHIFT_IDENTITY_LENS, attestationsFrom } from '../shifts/wire.js';
import type { NostrEventLike } from '../nostr/types.js';
import { cleanName, idKind, isKeyId, normalizeId, shortId } from './ids.js';
import { userName, type NameOptions, type NameRecord } from './index.js';
import { fetchProfiles, profileDisplayName, type ProfileMeta } from './profiles.js';

/** What the resolver needs of holosphere (every method optional but `get`). */
export interface ResolverHost {
  get(holon: string, lens: string, key: string): Promise<unknown>;
  getAll?(holon: string, lens: string): Promise<unknown>;
  getAllGlobal?(lens: string): Promise<unknown>;
  queryNostr?(filter: Record<string, unknown>): Promise<NostrEventLike[]>;
  /** holosphere's store; only `wire.isStandardPrimary` is consulted. */
  store?: unknown;
}

export interface NameResolverOptions {
  /** The holon on screen: its `users` lens is the first source for people. */
  holon?: string | null;
  /** The HNS lookup of the surface (a global signed name table), when it has one. */
  hns?: (id: string) => Promise<string | null | undefined>;
  /** The signed-in person: their own id is answered from here first. */
  self?: () => { id: string | number; first_name?: string | null; last_name?: string | null; username?: string | null; name?: string | null } | null | undefined;
  /** Pending join requests of a holon, when the surface watches them. */
  joinRequests?: (holon: string) => Promise<Array<{ pubkey: string; reason?: string }>>;
  /** The coordinator whose 31926 directory outranks other providers. */
  coordinatorPubkey?: string;
  /** How `users` records are formatted (the bot abbreviates the last name). */
  format?: NameOptions;
  /** A learned name is trusted this long (default 10 min). */
  ttlMs?: number;
  /** An id nothing names is not asked about again for this long (default 60 s). */
  missTtlMs?: number;
  now?: () => number;
}

export interface NameResolver {
  /** The cached name, else `shortId(id)` — and the id is queued for a lookup. */
  nameOf(id: string | number | null | undefined): string;
  /** Resolve now; the map holds every requested id (as given AND normalised), named or short. */
  resolve(ids: string | number | Iterable<string | number>): Promise<Map<string, string>>;
  /** The kind 0 learned for a key, for avatars and the like. */
  profileOf(id: string | number | null | undefined): ProfileMeta | undefined;
  /** Names the surface already holds (partner names, remembered holons…). */
  prime(entries: Iterable<readonly [string | number, string | null | undefined]>): void;
  /** Called after every lookup that changed a name; returns the unsubscribe. */
  subscribe(fn: (names: ReadonlyMap<string, string>) => void): () => void;
  /** Forget one id, or everything. */
  invalidate(id?: string | number): void;
  /** The holon on screen changed. */
  setHolon(holon: string | null | undefined): void;
  /** Every name known right now. */
  snapshot(): ReadonlyMap<string, string>;
}

const HEX64 = /^[0-9a-f]{64}$/;
const NO_NAME = new Set(['my holon', 'holon', 'unknown', 'unknown holon', 'external holon']);

type Entry = { name: string; at: number };

/** A users-lens record's name, '' when it has none (ids and numeric handles are not names). */
function recordName(rec: unknown, format: NameOptions): string {
  if (!rec || typeof rec !== 'object') return '';
  return cleanName(userName(rec as NameRecord, { ...format, idFallback: false, unknown: '' }));
}

/** A settings record's name — object or array of entries — ignoring the defaults that are not names. */
function settingsName(raw: unknown): string {
  const pick = (s: unknown) => {
    if (!s || typeof s !== 'object') return '';
    const o = s as Record<string, unknown>;
    const n = cleanName(o.name) || cleanName(o.title);
    return n && !NO_NAME.has(n.toLowerCase()) && !/^holon\s+\S+$/i.test(n) ? n : '';
  };
  if (Array.isArray(raw)) {
    for (const s of raw) {
      const n = pick(s);
      if (n) return n;
    }
    return '';
  }
  return pick(raw);
}

function recordsOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return Object.values(raw as Record<string, unknown>);
  return [];
}

export function createNameResolver(hs: ResolverHost, opts: NameResolverOptions = {}): NameResolver {
  const now = opts.now ?? (() => Date.now());
  const ttl = opts.ttlMs ?? 10 * 60_000;
  const missTtl = opts.missTtlMs ?? 60_000;
  const format = opts.format ?? {};
  let holon: string | null = opts.holon ? String(opts.holon) : null;

  const names = new Map<string, Entry>();
  const misses = new Map<string, number>();
  const profiles = new Map<string, ProfileMeta>();
  const listeners = new Set<(names: ReadonlyMap<string, string>) => void>();
  const pending = new Set<string>();
  let scheduled = false;
  let chain: Promise<unknown> = Promise.resolve();

  // Per-holon users and join-request caches, and the attestation directory.
  const users = new Map<string, { at: number; byId: Map<string, unknown> }>();
  const joins = new Map<string, { at: number; byKey: Map<string, string> }>();
  let directory: { at: number; parties: Map<string, string>; names: Map<string, string> } | null = null;

  const fresh = (id: string) => {
    const e = names.get(id);
    return e && now() - e.at < ttl ? e.name : '';
  };
  const missed = (id: string) => (misses.get(id) ?? -Infinity) > now() - missTtl;

  const snapshot = (): ReadonlyMap<string, string> => new Map([...names].map(([k, v]) => [k, v.name]));
  const emit = () => {
    const snap = snapshot();
    for (const fn of listeners) {
      try {
        fn(snap);
      } catch {
        /* a listener's error is its own */
      }
    }
  };

  const selfName = (id: string): string => {
    const me = opts.self?.();
    if (!me || normalizeId(me.id) !== id) return '';
    return recordName(me, format);
  };

  async function usersOf(h: string): Promise<Map<string, unknown>> {
    const cur = users.get(h);
    if (cur && now() - cur.at < Math.min(ttl, 30_000)) return cur.byId;
    const byId = new Map<string, unknown>();
    try {
      const raw = typeof hs.getAll === 'function' ? await hs.getAll(h, 'users') : null;
      for (const r of recordsOf(raw)) {
        const id = (r as { id?: unknown })?.id;
        if (id !== undefined && id !== null) byId.set(normalizeId(String(id)), r);
      }
    } catch {
      /* no users lens readable here */
    }
    users.set(h, { at: now(), byId });
    return byId;
  }

  async function personalRecord(id: string): Promise<unknown> {
    try {
      return await hs.get(id, 'users', id);
    } catch {
      return null;
    }
  }

  async function attestations(): Promise<{ parties: Map<string, string>; names: Map<string, string> }> {
    if (directory && now() - directory.at < ttl) return directory;
    let atts: IdentityAttestation[] = [];
    const wire = (hs.store as { wire?: { isStandardPrimary?(lens: string): boolean } } | undefined)?.wire;
    const wired = wire?.isStandardPrimary?.(SHIFT_IDENTITY_LENS) ?? true;
    if (wired && typeof hs.getAllGlobal === 'function') {
      try {
        atts = attestationsFrom(recordsOf(await hs.getAllGlobal(SHIFT_IDENTITY_LENS)) as never);
      } catch {
        atts = [];
      }
    }
    const o = { coordinatorPubkey: opts.coordinatorPubkey };
    const parties = new Map<string, string>();
    for (const [pk, identifier] of attestationIdentityMap(atts, o)) {
      const parsed = parseIdentifier(identifier);
      if (parsed) parties.set(pk, parsed.id);
    }
    directory = { at: now(), parties, names: attestationNameMap(atts, o) };
    return directory;
  }

  async function joinReasons(h: string): Promise<Map<string, string>> {
    if (!opts.joinRequests) return new Map();
    const cur = joins.get(h);
    if (cur && now() - cur.at < missTtl) return cur.byKey;
    const byKey = new Map<string, string>();
    try {
      for (const r of await opts.joinRequests(h)) {
        const pk = normalizeId(r.pubkey);
        const reason = cleanName(r.reason);
        if (pk && reason && !isPlaceholder(reason, pk)) byKey.set(pk, reason);
      }
    } catch {
      /* no requests readable */
    }
    joins.set(h, { at: now(), byKey });
    return byKey;
  }

  const isPlaceholder = (name: string, id: string) => name === shortId(id) || /^npub1[02-9ac-hj-np-z]{4,}/i.test(name);

  async function holonName(id: string): Promise<string> {
    try {
      const n = settingsName(await hs.get(id, 'settings', id));
      if (n) return n;
    } catch {
      /* no settings */
    }
    if (opts.hns) {
      try {
        const n = cleanName(await opts.hns(id));
        if (n) return n;
      } catch {
        /* no HNS */
      }
    }
    return '';
  }

  /** One lookup over a set of normalised ids. Returns what it learned. */
  async function lookup(ids: Set<string>): Promise<Map<string, string>> {
    const learned = new Map<string, string>();
    const left = new Set<string>();
    for (const id of ids) {
      if (!id) continue;
      const me = selfName(id);
      if (me) learned.set(id, me);
      else if (!fresh(id) && !missed(id)) left.add(id);
    }
    if (!left.size) return learned;

    const people = [...left].filter((id) => idKind(id) !== 'holon');
    const keys = people.filter((id) => HEX64.test(id));

    // 1–2. The holon's users, then the personal-holon record.
    const byId = holon ? await usersOf(holon) : new Map<string, unknown>();
    const fromUsers = async (id: string): Promise<string> => {
      const n = recordName(byId.get(id), format);
      if (n) return n;
      if (/^\d+$/.test(id)) return recordName(await personalRecord(id), format);
      return '';
    };
    for (const id of people) {
      const n = await fromUsers(id);
      if (n) {
        learned.set(id, n);
        left.delete(id);
      }
    }

    // 3. Keys: the 31926 directory — a Telegram person behind the key, else the attested name.
    const unnamedKeys = keys.filter((k) => left.has(k));
    if (unnamedKeys.length) {
      const dir = await attestations();
      for (const k of unnamedKeys) {
        const party = dir.parties.get(k);
        let n = party ? await fromUsers(party) : '';
        if (!n) n = cleanName(dir.names.get(k));
        if (n) {
          learned.set(k, n);
          left.delete(k);
        }
      }
    }

    // 4. Keys: their kind 0 on the relays, one bounded query per hundred.
    const unprofiled = keys.filter((k) => left.has(k));
    if (unprofiled.length) {
      const found = await fetchProfiles(hs.queryNostr ? (hs as { queryNostr(f: Record<string, unknown>): Promise<NostrEventLike[]> }) : null, unprofiled);
      for (const [pk, p] of found) {
        profiles.set(pk, p);
        const n = profileDisplayName(p);
        if (n && left.has(pk)) {
          learned.set(pk, n);
          left.delete(pk);
        }
      }
    }

    // 5. Keys: the name they wrote on their join request.
    const unjoined = keys.filter((k) => left.has(k));
    if (unjoined.length && holon) {
      const reasons = await joinReasons(holon);
      for (const k of unjoined) {
        const n = reasons.get(k);
        if (n) {
          learned.set(k, n);
          left.delete(k);
        }
      }
    }

    // 6. Holons — and keys no person source named: settings, then HNS.
    for (const id of [...left]) {
      if (/^\d+$/.test(id)) continue; // a Telegram id is never a holon's name
      const n = await holonName(id);
      if (n) {
        learned.set(id, n);
        left.delete(id);
      }
    }

    for (const id of left) misses.set(id, now());
    return learned;
  }

  async function run(requested: Iterable<string>): Promise<void> {
    const ids = new Set<string>();
    for (const id of requested) if (id) ids.add(id);
    for (const id of pending) ids.add(id);
    pending.clear();
    if (!ids.size) return;
    const learned = await lookup(ids);
    let changed = false;
    for (const [id, name] of learned) {
      if (names.get(id)?.name !== name) changed = true;
      names.set(id, { name, at: now() });
      misses.delete(id);
    }
    if (changed) emit();
  }

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      chain = chain.then(() => run([])).catch(() => {});
    }, 0);
  };

  const resolver: NameResolver = {
    nameOf(id) {
      const n = normalizeId(id);
      if (!n) return '';
      const me = selfName(n);
      if (me) return me;
      const known = fresh(n);
      if (known) return known;
      if (!missed(n)) {
        pending.add(n);
        schedule();
      }
      return shortId(n);
    },
    async resolve(ids) {
      const list = typeof ids === 'string' || typeof ids === 'number' ? [ids] : [...ids];
      const norm = list.map((id) => normalizeId(id)).filter(Boolean);
      const next = chain.then(() => run(norm));
      chain = next.catch(() => {});
      await next;
      const out = new Map<string, string>();
      list.forEach((id, i) => {
        const n = norm[i];
        if (!n) return;
        const name = selfName(n) || fresh(n) || shortId(n);
        out.set(String(id), name);
        out.set(n, name);
      });
      return out;
    },
    profileOf(id) {
      return profiles.get(normalizeId(id));
    },
    prime(entries) {
      let changed = false;
      for (const [id, name] of entries) {
        const n = normalizeId(id);
        const v = cleanName(name);
        if (!n || !v || isPlaceholder(v, n) || NO_NAME.has(v.toLowerCase())) continue;
        if (names.get(n)?.name !== v) changed = true;
        names.set(n, { name: v, at: now() });
        misses.delete(n);
      }
      if (changed) emit();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    invalidate(id) {
      if (id === undefined) {
        names.clear();
        misses.clear();
        profiles.clear();
        users.clear();
        joins.clear();
        directory = null;
        return;
      }
      const n = normalizeId(id);
      names.delete(n);
      misses.delete(n);
      profiles.delete(n);
      users.clear();
    },
    setHolon(h) {
      holon = h ? String(h) : null;
    },
    snapshot,
  };
  return resolver;
}

export { isKeyId };
