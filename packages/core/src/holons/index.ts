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
  TELEGRAM_CLAIM_PREFIX,
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
import { cleanName, isPlaceholderName } from '../identity/ids.js';
import { approvedJoinKeys, settleJoinRequest } from './requests.js';

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
  /** The holon asked (the `h` tag). */
  holon: string;
  /** The Telegram user the request CLAIMS to be (its `i` tag) — unproven, see `describeApplicant`. */
  telegramId?: string;
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
  const claim = (event.tags ?? []).find((t) => t[0] === 'i' && typeof t[1] === 'string' && t[1].startsWith(TELEGRAM_CLAIM_PREFIX))?.[1];
  const telegramId = claim?.slice(TELEGRAM_CLAIM_PREFIX.length);
  return {
    pubkey: event.pubkey.toLowerCase(),
    at: event.created_at,
    reason: typeof event.content === 'string' ? event.content : '',
    eventId: event.id,
    holon: h,
    ...(telegramId && /^\d{1,20}$/.test(telegramId) ? { telegramId } : {}),
  };
}

export interface JoinOptions extends HolonPublishOptions {
  /** Carried in the request — by convention the person's display name. */
  reason?: string;
  /**
   * The person's Telegram id, when they signed in with Telegram. The bot of
   * a Telegram-born holon proves it from the key and links a group member
   * without asking an admin.
   */
  telegramId?: string | number;
}

/** Ask to join: a kind-9021 signed by the person. Never writes a profile (see the header). */
export function requestToJoin(hs: HoloSphere, holon: string, signer: NostrSigner, opts: JoinOptions = {}): SignedEvent {
  const ctx = holonProjectionCtx(hs, holon, opts);
  const event = signer.sign(groupJoinRequestTemplate(ctx, holon, opts.reason ?? '', opts.telegramId));
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

export interface WatchAllJoinRequestsOptions {
  /** Only requests stamped with this namespace (`n` tag). */
  appName?: string;
  /** Unix seconds: nothing older is asked for. */
  since?: number;
}

/**
 * Every join request of the namespace, whatever holon it asks for — ONE
 * filter, for a service that answers for many holons (the bot). A watch per
 * holon would spend the relay's REQ budget; this never grows with the number
 * of holons. Each verified request is handed over as it arrives, replays
 * included: the listener dedupes by `eventId` and checks the seat itself.
 * Returns a stop function.
 */
export function watchAllJoinRequests(hs: HoloSphere, opts: WatchAllJoinRequestsOptions, onRequest: (request: JoinRequest) => void): () => void {
  const filter: Record<string, unknown> = { kinds: [GROUP_JOIN_REQUEST_KIND], '#n': [opts.appName ?? DEFAULT_APP] };
  if (typeof opts.since === 'number' && opts.since > 0) filter.since = Math.floor(opts.since);
  return hs.subscribeNostr(filter as never, (event: NostrEventLike) => {
    const r = parseJoinRequest(event);
    if (r) onRequest(r);
  });
}

// ── Seating ────────────────────────────────────────────────────────────────

export interface SeatOptions extends HolonPublishOptions {
  role?: Role;
  /**
   * The name the person gave on their join request. Written as their `users`
   * record by the admin when they have none yet, so the roster names them
   * from the first moment; their own later write replaces it.
   */
  name?: string;
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
  await seedProfile(hs, holon, pub, opts.name);
  return pub;
}

/** The joiner's record from the name on their request — only when they have none, never a placeholder. */
async function seedProfile(hs: HoloSphere, holon: string, pub: string, name: string | undefined): Promise<void> {
  const first = cleanName(name);
  if (!first || isPlaceholderName(first, pub)) return;
  try {
    const cur = await hs.get(holon, 'users', pub);
    if (cur && typeof cur === 'object' && !(cur as { _deleted?: boolean })._deleted) return;
    await hs.put(holon, 'users', { id: pub, first_name: first });
  } catch {
    /* the roster still names them through the request itself */
  }
}

/** Unseat a key: the signed `_members` remove, a kind-9001, and the refreshed state. Admins only. */
export async function removeSeat(hs: HoloSphere, holon: string, pubkey: string, signer: NostrSigner, opts: HolonPublishOptions = {}): Promise<string> {
  const pub = await removeHolonMember(hs, holon, pubkey);
  const ctx = holonProjectionCtx(hs, holon, opts);
  hs.publishNostrEvents(signer.sign(groupRemoveUserTemplate(ctx, holon, pub)));
  await publishGroupState(hs, holon, signer, opts);
  afterRoster(hs, holon);
  // An approval on record would have the holon's own service seat the key
  // again at its next roster sync: unseating withdraws it.
  try {
    if ((await approvedJoinKeys(hs, holon)).includes(pub)) await settleJoinRequest(hs, holon, pub, 'declined', { now: opts.now });
  } catch {
    /* no record readable: nothing to withdraw */
  }
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
  for (const [k, v] of Object.entries(profile)) {
    if (typeof v !== 'string' || !v.trim()) continue;
    // A shortened npub or hex prefix is a stand-in, never a name: a record
    // written with one would show it on every surface until the person edits.
    if ((k === 'first_name' || k === 'username' || k === 'last_name') && isPlaceholderName(v, me)) continue;
    record[k] = v.trim();
  }
  await hs.put(holon, 'users', record);
  return true;
}

// ── Answering requests ─────────────────────────────────────────────────────
export {
  JOIN_REQUESTS_LENS,
  approvedJoinKeys,
  describeApplicant,
  joinRequestRecords,
  recordJoinRequest,
  settleJoinRequest,
  type Applicant,
  type DescribeApplicantOptions,
  type JoinRequestRecord,
  type JoinRequestStatus,
} from './requests.js';

// ── Trust ──────────────────────────────────────────────────────────────────
export { membersTrustedAuthors } from './trust.js';

// ── My holons (cross-device) ───────────────────────────────────────────────
// Lives in `list.ts` so leaf modules can import it without this file's stack.
export {
  MY_HOLONS_LENS,
  forgetHolon,
  isRememberedHolon,
  myHolons,
  rememberHolon,
  type HolonListStore,
  type RememberedHolon,
} from './list.js';

// ── People across holons ───────────────────────────────────────────────────
export {
  findPeople,
  loadFederationPeople,
  loadPeopleAcross,
  peopleAcross,
  type FederationPeopleHost,
  type FederationPeopleOptions,
  type FederationPerson,
  type HolonBridge,
  type HolonRoster,
  type LoadPeopleOptions,
  type PeopleAcross,
  type PeopleAcrossOptions,
  type PeopleHost,
  type PersonAcross,
} from './people.js';
