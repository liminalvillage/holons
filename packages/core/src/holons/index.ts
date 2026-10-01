// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/holons — how a holon is formed and joined, by key.
//
// A holon is founded when a key signs the genesis of its `_members` log
// (`@holons/core/protocol` founding); from then on the log says who counts.
// This module is the shape a person meets it in, on any surface: create a
// holon, ask to join one, seat or unseat a key, and keep the holon's
// NIP-29 shadow current. "Holon" is what hubs.network calls one category of
// holon — the rules here are the same for every holon a key can found.
//
// NIP-29 reading: the relay (relay.holons.io, strfry) does not implement
// groups, so the holon's ADMINS play the relay's role — they sign the
// 39000/39001/39002 state and the 9000/9001 moderation events; members send
// their own 9021 join / 9022 leave requests. A real NIP-29 relay can take
// over unchanged. Everything that publishes takes a `NostrSigner`: holosphere
// only carries already-signed events (`publishNostrEvents`).
//
// One consequence of as-of-time membership shapes the join flow: a record a
// person signs BEFORE an admin seats them never counts, so a join request
// carries its own display name and the person's `users` profile is written
// only once they are seated (`ensureProfile`).

import type { HoloSphere } from 'holosphere';
import { verifyEvent } from 'nostr-tools/pure';
import { eventToItem } from 'holosphere/nostr-events.js';
import { resolveHolonAuthority } from '../holosphere/authority.js';
import type { NostrSigner } from '../holosphere/signers.js';
import {
  GROUP_JOIN_REQUEST_KIND,
  buildGroupState,
  groupJoinRequestTemplate,
  groupLeaveRequestTemplate,
  groupPutUserTemplate,
  groupRemoveUserTemplate,
  groupStateHash,
} from '../nostr/groups.js';
import type { EventTemplate, NostrEventLike, ProjectionCtx } from '../nostr/types.js';
import { sync as syncPrivacy } from '../privacy/audience.js';
import { addHolonMember, foundHolon, holonMembers, myHolonRole, newHolonId, removeHolonMember } from '../protocol/founding.js';
import { readMembersLog } from '../protocol/membership.js';
import type { Role } from '../protocol/types.js';

const HEX64 = /^[0-9a-f]{64}$/i;
/** The namespace stamped on every event when the caller names none. */
const DEFAULT_APP = 'Holons';

/** What every publishing call may take. */
export interface HolonPublishOptions {
  /** App namespace for the `n` tag (Holons vs HolonsDebug on a shared relay). */
  appName?: string;
  /** Unix seconds; injectable for tests. */
  now?: () => number;
}

type StoreHost = HoloSphere & {
  store: { getEvents(holon: string | null, lens: string, id: string): Array<{ pubkey: string; created_at: number }> };
};

/** A signed event, as `NostrSigner.sign` returns it. */
export type SignedEvent = ReturnType<NostrSigner['sign']>;

// ── Projection context ─────────────────────────────────────────────────────

/**
 * The context the NIP-29 templates need for a key-founded holon: the anchor
 * (genesis key) as `holonPubkey`, and members that already ARE pubkeys.
 */
export function holonProjectionCtx(hs: HoloSphere, holon: string, opts: HolonPublishOptions = {}): ProjectionCtx {
  const anchor = resolveHolonAuthority(hs, holon).anchor ?? String(hs.currentPubkey ?? '').toLowerCase();
  return {
    appName: opts.appName ?? DEFAULT_APP,
    holonPubkey: anchor,
    ...(opts.now ? { now: opts.now } : {}),
    pubkeyFor: (id) => (HEX64.test(String(id)) ? String(id).toLowerCase() : undefined),
  };
}

// ── Creating ───────────────────────────────────────────────────────────────

export interface CreateHolonOptions extends HolonPublishOptions {
  name?: string;
  /** Written as the founder's `users` record once founded (see `ensureProfile`). */
  profile?: ProfileInput;
}

export interface CreateHolonResult {
  holon: string;
  /** The founder's key: the holon's anchor. */
  anchor: string;
}

/**
 * Mint an id, found it with this instance's key (genesis admin), publish the
 * group state and, when given, the founder's profile.
 */
export async function createHolon(hs: HoloSphere, signer: NostrSigner, opts: CreateHolonOptions = {}): Promise<CreateHolonResult> {
  const holon = newHolonId();
  const { anchor } = await foundHolon(hs, holon, { name: opts.name });
  await publishGroupState(hs, holon, signer, opts);
  if (opts.profile) await ensureProfile(hs, holon, opts.profile);
  return { holon, anchor };
}

// ── Joining ────────────────────────────────────────────────────────────────

/** A member's request to join, as read from a kind-9021 event. */
export interface JoinRequest {
  pubkey: string;
  /** Unix seconds. */
  at: number;
  /** What they wrote — by convention their display name. */
  reason: string;
  eventId: string;
}

/** The relay filter for a holon's join requests. */
export function joinRequestFilter(holon: string): { kinds: number[]; '#h': string[] } {
  return { kinds: [GROUP_JOIN_REQUEST_KIND], '#h': [holon] };
}

/**
 * A verified join request for `holon` (or for any holon when none is named),
 * or null: wrong kind, missing `h`, bad signature, unsigned.
 */
export function parseJoinRequest(event: NostrEventLike | null | undefined, holon?: string): JoinRequest | null {
  if (!event || event.kind !== GROUP_JOIN_REQUEST_KIND) return null;
  const h = (event.tags ?? []).find((t) => t[0] === 'h')?.[1];
  if (!h || (holon !== undefined && h !== holon)) return null;
  if (!HEX64.test(event.pubkey ?? '') || !event.id || !event.sig) return null;
  // Verify a plain copy: nostr-tools caches "verified" on the object itself,
  // and a copy of a verified event (spread keeps the marker) would pass.
  const { id, pubkey, kind, created_at, tags, content, sig } = event;
  try {
    if (!verifyEvent({ id, pubkey, kind, created_at, tags, content, sig } as never)) return null;
  } catch {
    return null;
  }
  return {
    pubkey: event.pubkey.toLowerCase(),
    at: event.created_at,
    reason: typeof event.content === 'string' ? event.content : '',
    eventId: event.id,
  };
}

export interface JoinOptions extends HolonPublishOptions {
  /** Carried in the request — by convention the person's display name. */
  reason?: string;
}

/** Ask to join: a kind-9021 signed by the person. Never writes a profile (see the header). */
export function requestToJoin(hs: HoloSphere, holon: string, signer: NostrSigner, opts: JoinOptions = {}): SignedEvent {
  const ctx = holonProjectionCtx(hs, holon, opts);
  const event = signer.sign(groupJoinRequestTemplate(ctx, holon, opts.reason ?? ''));
  hs.publishNostrEvents(event);
  return event;
}

/** Leave: a kind-9022 signed by the person. An admin unseats the key (`removeSeat`). */
export function leaveHolon(hs: HoloSphere, holon: string, signer: NostrSigner, opts: HolonPublishOptions = {}): SignedEvent {
  const ctx = holonProjectionCtx(hs, holon, opts);
  const event = signer.sign(groupLeaveRequestTemplate(ctx, holon));
  hs.publishNostrEvents(event);
  return event;
}

/**
 * Live join requests of a holon: the newest request per key, keys already
 * seated left out, newest first. Every event is signature-checked. Returns
 * a stop function. Seated keys are read once when the watch starts — start
 * a new watch after seating someone.
 */
export function watchJoinRequests(hs: HoloSphere, holon: string, onChange: (requests: JoinRequest[]) => void): () => void {
  const byKey = new Map<string, JoinRequest>();
  let seated = new Set<string>();
  let stopped = false;
  const emit = () => {
    if (stopped) return;
    onChange([...byKey.values()].filter((r) => !seated.has(r.pubkey)).sort((a, b) => b.at - a.at));
  };
  holonMembers(hs, holon)
    .then((m) => {
      seated = new Set(m.keys());
      emit();
    })
    .catch(() => {
      /* not signing: nobody is seated */
    });
  const close = hs.subscribeNostr(joinRequestFilter(holon), (event: NostrEventLike) => {
    const r = parseJoinRequest(event, holon);
    if (!r) return;
    const cur = byKey.get(r.pubkey);
    if (cur && cur.at >= r.at) return;
    byKey.set(r.pubkey, r);
    emit();
  });
  return () => {
    stopped = true;
    close();
  };
}

/** The join requests seen within `windowMs` (default 1.5 s) — a one-shot read. */
export function listJoinRequests(hs: HoloSphere, holon: string, opts: { windowMs?: number } = {}): Promise<JoinRequest[]> {
  return new Promise((resolve) => {
    let latest: JoinRequest[] = [];
    const stop = watchJoinRequests(hs, holon, (r) => {
      latest = r;
    });
    setTimeout(() => {
      stop();
      resolve(latest);
    }, opts.windowMs ?? 1500);
  });
}

// ── Seating ────────────────────────────────────────────────────────────────

export interface SeatOptions extends HolonPublishOptions {
  role?: Role;
}

/**
 * Seat a key (hex or npub): the signed `_members` add, a kind-9000 put-user,
 * and the refreshed group state. The instance key must be an admin.
 */
export async function approveJoin(hs: HoloSphere, holon: string, pubkey: string, signer: NostrSigner, opts: SeatOptions = {}): Promise<string> {
  const role: Role = opts.role === 'admin' ? 'admin' : 'member';
  const pub = await addHolonMember(hs, holon, pubkey, role);
  const ctx = holonProjectionCtx(hs, holon, opts);
  hs.publishNostrEvents(signer.sign(groupPutUserTemplate(ctx, holon, pub, role)));
  await publishGroupState(hs, holon, signer, opts);
  afterRoster(hs, holon);
  return pub;
}

/** Unseat a key: the signed `_members` remove, a kind-9001, and the refreshed state. Admins only. */
export async function removeSeat(hs: HoloSphere, holon: string, pubkey: string, signer: NostrSigner, opts: HolonPublishOptions = {}): Promise<string> {
  const pub = await removeHolonMember(hs, holon, pubkey);
  const ctx = holonProjectionCtx(hs, holon, opts);
  hs.publishNostrEvents(signer.sign(groupRemoveUserTemplate(ctx, holon, pub)));
  await publishGroupState(hs, holon, signer, opts);
  afterRoster(hs, holon);
  return pub;
}

/**
 * A roster change moves the holon's private scopes with it: the new member
 * gets every key, the removed one loses them. Fire-and-forget — the seat is
 * done; the keys follow as the relay allows.
 */
function afterRoster(hs: HoloSphere, holon: string): void {
  syncPrivacy(hs, holon).catch((e) => console.warn('[holons] privacy sync after roster change failed:', (e as Error)?.message));
}

// ── Group state ────────────────────────────────────────────────────────────

// Per instance: the hash of each state event last published per holon, so an
// unchanged roster republishes nothing (the same rule the bot applies).
const published = new WeakMap<object, Map<string, string[]>>();

/**
 * Publish the holon's NIP-29 state (39000 metadata, 39001 admins, 39002
 * members) from its settings and signed log — only the events whose content
 * changed since this instance last published them. Returns what was sent.
 */
export async function publishGroupState(hs: HoloSphere, holon: string, signer: NostrSigner, opts: HolonPublishOptions = {}): Promise<EventTemplate[]> {
  const members = await holonMembers(hs, holon);
  const admins = [...members].filter(([, role]) => role === 'admin').map(([pub]) => pub);
  const ctx = holonProjectionCtx(hs, holon, opts);
  let settings: Record<string, unknown> = {};
  try {
    const raw = await hs.get(holon, 'settings', holon);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) settings = raw as Record<string, unknown>;
  } catch {
    /* no settings yet */
  }
  const templates = buildGroupState(ctx, holon, settings, [...members.keys()], admins);
  const hashes = templates.map(groupStateHash);
  let perHolon = published.get(hs);
  if (!perHolon) published.set(hs, (perHolon = new Map()));
  const prev = perHolon.get(holon) ?? [];
  const changed = templates.filter((_, i) => hashes[i] !== prev[i]);
  perHolon.set(holon, hashes);
  if (changed.length) hs.publishNostrEvents(changed.map((t) => signer.sign(t)));
  return changed;
}

// ── Profiles ───────────────────────────────────────────────────────────────

/** The fields a seated key writes about itself. */
export interface ProfileInput {
  first_name?: string;
  last_name?: string;
  username?: string;
  picture?: string;
}

/**
 * Write this key's `users` record in `holon` if no ACCEPTED one exists —
 * i.e. none signed by this key after it was seated. A no-op when the key is
 * not seated (the write would never count). True when a record was written.
 */
export async function ensureProfile(hs: HoloSphere, holon: string, profile: ProfileInput): Promise<boolean> {
  const me = String(hs.currentPubkey ?? '').toLowerCase();
  if (!me || !(await myHolonRole(hs, holon))) return false;
  try {
    await hs.get(holon, 'users', me); // sync the lens
  } catch {
    /* absent */
  }
  const auth = resolveHolonAuthority(hs, holon);
  const mine = (hs as StoreHost).store.getEvents(holon, 'users', me).filter((e) => String(e.pubkey).toLowerCase() === me);
  const accepted = mine.some((e) => {
    const item = eventToItem(e as never) as { _deleted?: boolean } | null;
    if (!item || item._deleted === true) return false;
    return !auth.actors || auth.actors.isAcceptedAt(me, e.created_at);
  });
  if (accepted) return false;
  // A seat is stamped strictly after the log's latest second, so a profile
  // written in the same breath as the approval could carry an EARLIER time
  // and never count. Wait for the seat's second to arrive (at most a few).
  const seatAt = Math.max(
    0,
    ...(await readMembersLog(hs, holon))
      .filter((e) => {
        try {
          return String(JSON.parse(e.content || '{}').pubkey ?? '').toLowerCase() === me;
        } catch {
          return false;
        }
      })
      .map((e) => e.created_at),
  );
  const wait = seatAt - Math.floor(Date.now() / 1000);
  if (wait > 0 && wait <= 5) await new Promise((r) => setTimeout(r, wait * 1000 + 50));
  const record: Record<string, unknown> = { id: me };
  for (const [k, v] of Object.entries(profile)) if (typeof v === 'string' && v.trim()) record[k] = v.trim();
  await hs.put(holon, 'users', record);
  return true;
}

// ── My holons (cross-device) ───────────────────────────────────────────────

/** The lens in a person's own holon that lists the holons they keep. */
export const MY_HOLONS_LENS = 'holons';

export interface RememberedHolon {
  id: string;
  name?: string;
  /** When it was (last) remembered, ms epoch. */
  at: number;
}

export function isRememberedHolon(value: unknown): value is RememberedHolon {
  const r = value as RememberedHolon;
  return !!r && typeof r === 'object' && typeof r.id === 'string' && r.id.trim() !== '' && typeof r.at === 'number' && Number.isFinite(r.at) && (r.name === undefined || typeof r.name === 'string');
}

/** The slice of a holosphere the list needs. */
export interface HolonListStore {
  getAll(holon: string, lens: string): Promise<unknown>;
  put(holon: string, lens: string, data: object): Promise<unknown>;
  delete(holon: string, lens: string, key: string): Promise<unknown>;
}

/** Remember `holon` in `person`'s own list (their pubkey holon). An empty name keeps the old one. */
export async function rememberHolon(store: HolonListStore, person: string, entry: { id: string; name?: string }, now = Date.now()): Promise<RememberedHolon> {
  const id = String(entry.id ?? '').trim();
  if (!id) throw new Error('rememberHolon: a holon id is required');
  const name = String(entry.name ?? '').trim();
  const current = (await myHolons(store, person)).find((h) => h.id === id);
  const next: RememberedHolon = { id, at: now };
  const keep = name || current?.name;
  if (keep) next.name = keep;
  await store.put(person, MY_HOLONS_LENS, next);
  return next;
}

export async function forgetHolon(store: HolonListStore, person: string, holon: string): Promise<void> {
  await store.delete(person, MY_HOLONS_LENS, String(holon));
}

/** The holons `person` keeps, most recent first. */
export async function myHolons(store: HolonListStore, person: string): Promise<RememberedHolon[]> {
  let raw: unknown;
  try {
    raw = await store.getAll(person, MY_HOLONS_LENS);
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
  return list.filter(isRememberedHolon).sort((a, b) => b.at - a.at);
}
