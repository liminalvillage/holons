// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/linking — tying a key-founded holon to a Telegram chat.
//
// Two holons take part: D, founded from a screen (its admins are keys seated
// in its `_members` log), and T, a Telegram chat (its anchor is the bot key
// that founded it). Neither side can write into the other, so the link is a
// pair of signed records that name each other, one in each holon's `links`
// lens, both keyed by the same id — and each side's record counts only when
// its own authority signed it. Afterwards the two seat each other's admin
// key, so a dashboard admin edits the chat's holon and the bot brings the
// chat's members into the dashboard holon.
//
// The handshake is a challenge–response around a one-time token τ that only
// travels in a Telegram deep link:
//
//   1. OFFER   an admin of D writes D/links/H = {status:'offered'} where
//              H = hash(τ); the deep link carries `link_<D>_<τ>`.
//   2. ACCEPT  the bot, on `/start link_…` from a chat admin, hashes τ, reads
//              D/links/H — which counts only if an admin of D (at that time)
//              signed it — founds T if needed, seats that admin in T, writes
//              T/links/H = {status:'accepted', peer: D} and a claim record so
//              the screen (which knows D and H, not T) learns T.
//   3. COMPLETE the screen checks T/links/H is signed by T's anchor and names
//              D, a human confirms the chat's title, and D/links/H becomes
//              {status:'linked', peer: T}; the bot key is seated as admin of D.
//   4. UNLINK  either side alone: its record → 'unlinked', the other's key
//              unseated (as-of-time: nothing already written is lost).
//
// Nobody but D's admins can offer; nobody but T's anchor can accept; H never
// reveals τ; τ is single-use and expires; a human confirms before the bot
// key is seated. Pure helpers first, then the store-level steps.

import type { HoloSphere } from 'holosphere';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { holonAnchor, itemByAuthor, itemsByAuthor } from 'holosphere/authority.js';
import { eventToItem } from 'holosphere/nostr-events.js';
import { resolveHolonAuthority } from '../holosphere/authority.js';
import { CLAIM_MAX_AGE_MS, isClaimToken, newClaimToken, readHolonClaim, recordHolonClaim, watchHolonClaim, type ChatLike, type ClaimWatchStore, type HolonKind } from '../claims/index.js';
import { removeFederationPartner, setFederationPartner } from '../federation/partners.js';
import { HOLON_ID_RE, addHolonMember, isHolonId, myHolonRole, removeHolonMember } from '../protocol/founding.js';
import { actorsFromMembersLog, nextMembersAt, readMembersLog, syncMembersLog } from '../protocol/membership.js';
import type { Role } from '../protocol/types.js';

/** The lens, in both holons, that holds the link records. */
export const LINKS_LENS = 'links';
/** Payload prefix that tells the bot a `/start` carries a link. */
export const LINK_PREFIX = 'link_';
/** An offer older than this is stale. */
export const LINK_MAX_AGE_MS = CLAIM_MAX_AGE_MS;

const HEX64 = /^[0-9a-f]{64}$/i;
const LINK_ID_RE = /^[0-9a-f]{32}$/;
// The holon id has no `_` (its alphabet is [a-z0-9] after the prefix) and the
// token may, so the last `_` after the id is the only ambiguity-free split.
const PAYLOAD_RE = /^link_((?:holon|hub)_[a-z0-9]{12,32})_([A-Za-z0-9_-]{16,48})$/;

// ── Pure: tokens, ids, payloads ────────────────────────────────────────────

/** Mint the one-time token τ (same alphabet and entropy as a claim token). */
export const linkToken = newClaimToken;

/**
 * The record id for a token: sha256(τ) as 32 hex chars (128 bits). Short
 * enough to be a claim-record key (`isClaimToken`), long enough to be
 * unguessable, and revealing nothing about τ.
 */
export function linkId(token: string): string {
  if (!isClaimToken(token)) throw new Error('linkId: not a link token');
  return bytesToHex(sha256(new TextEncoder().encode(token))).slice(0, 32);
}

export function isLinkId(value: unknown): value is string {
  return typeof value === 'string' && LINK_ID_RE.test(value);
}

/** The `/start` payload that carries a link out: `link_<holon>_<token>`. */
export function linkPayload(holon: string, token: string): string {
  if (!isHolonId(holon)) throw new Error('linkPayload: only a key-founded holon can be linked');
  if (!isClaimToken(token)) throw new Error('linkPayload: not a link token');
  return `${LINK_PREFIX}${holon}_${token}`;
}

/** The holon and token a `/start` payload carries, or null. Whole `/start …` lines are accepted too. */
export function parseLinkPayload(input: string | null | undefined): { holon: string; token: string } | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const payload = /^\/start(@\S+)?\s+/i.test(raw) ? raw.replace(/^\/start(@\S+)?\s+/i, '').trim() : raw;
  const m = PAYLOAD_RE.exec(payload);
  if (!m || !HOLON_ID_RE.test(m[1])) return null;
  return { holon: m[1], token: m[2] };
}

// ── Pure: records and their states ─────────────────────────────────────────

export type LinkStatus = 'offered' | 'accepted' | 'linked' | 'unlinked';
export type LinkEvent = 'offer' | 'accept' | 'complete' | 'unlink';

export interface LinkChat {
  id: string;
  kind: HolonKind;
  title?: string;
}

/** One side's record. In D it goes offered → linked → unlinked; in T accepted → unlinked. */
export interface LinkRecord {
  /** `linkId(τ)` — the same in both holons. */
  id: string;
  kind: 'telegram';
  status: LinkStatus;
  /** The other holon's id. */
  peer?: string;
  /** The other holon's speaking key: D's offering admin, or T's anchor. */
  peerAnchor?: string;
  /** Who wrote this: the admin's pubkey (D) or the Telegram user id (T). */
  by?: string;
  /** The chat, as the bot saw it (T's record; copied into D's on completion as `name`). */
  chat?: LinkChat;
  /** A display name for the peer. */
  name?: string;
  /** ms epoch. */
  at: number;
}

const STATUSES: LinkStatus[] = ['offered', 'accepted', 'linked', 'unlinked'];

export function isLinkRecord(value: unknown): value is LinkRecord {
  const r = value as LinkRecord;
  return (
    !!r &&
    typeof r === 'object' &&
    isLinkId(r.id) &&
    r.kind === 'telegram' &&
    STATUSES.includes(r.status) &&
    typeof r.at === 'number' &&
    Number.isFinite(r.at) &&
    (r.peer === undefined || typeof r.peer === 'string') &&
    (r.peerAnchor === undefined || HEX64.test(r.peerAnchor)) &&
    (r.by === undefined || typeof r.by === 'string') &&
    (r.name === undefined || typeof r.name === 'string') &&
    (r.chat === undefined || (!!r.chat && typeof r.chat === 'object' && typeof r.chat.id === 'string'))
  );
}

/** An offer the other side should still honour: recent, not from the future. */
export function isFreshLink(record: Pick<LinkRecord, 'at'>, now = Date.now(), maxAgeMs = LINK_MAX_AGE_MS): boolean {
  return record.at <= now + 60_000 && now - record.at <= maxAgeMs;
}

/** The state machine, as a table: the next status, or null when the event is not allowed from `from`. */
export function nextLinkState(from: LinkStatus | null, event: LinkEvent): LinkStatus | null {
  switch (event) {
    case 'offer':
      return from === null || from === 'unlinked' ? 'offered' : null;
    case 'accept':
      return from === 'offered' ? 'accepted' : null;
    case 'complete':
      return from === 'offered' || from === 'accepted' ? 'linked' : null;
    case 'unlink':
      return from === 'accepted' || from === 'linked' ? 'unlinked' : null;
  }
}

// ── Store level ────────────────────────────────────────────────────────────

type Host = HoloSphere & {
  store: { getEvents(holon: string | null, lens: string, id: string): Array<{ pubkey: string; created_at: number }> };
  _readAuthority?: { invalidate(holon?: string): void };
};

const me = (hs: HoloSphere) => String(hs.currentPubkey ?? '').toLowerCase();

async function requireAdmin(hs: HoloSphere, holon: string): Promise<string> {
  const key = me(hs);
  if (!key || !hs.signingEnabled) throw new Error('Sign in with a key first.');
  if ((await myHolonRole(hs, holon)) !== 'admin') throw new Error('Only an admin of this holon can link it.');
  return key;
}

async function readOwn(hs: HoloSphere, holon: string, id: string): Promise<LinkRecord | null> {
  try {
    await hs.get(holon, LINKS_LENS, id); // sync the lens
  } catch {
    /* absent */
  }
  const item = itemByAuthor((hs as Host).store, holon, LINKS_LENS, id, me(hs));
  return isLinkRecord(item) ? item : null;
}

export interface OfferResult {
  token: string;
  id: string;
  record: LinkRecord;
  /** The `/start` payload for the deep links. */
  payload: string;
}

/**
 * Step 1, on the screen: an admin of `holon` offers a link. Writes the
 * `offered` record (signed by the admin) and returns the token — the only
 * copy; it must go out in the deep link and nowhere else.
 */
export async function offerTelegramLink(hs: HoloSphere, holon: string, opts: { token?: string; now?: number } = {}): Promise<OfferResult> {
  const h = String(holon ?? '').trim();
  if (!isHolonId(h)) throw new Error('Only a key-founded holon can be linked to a Telegram chat.');
  const admin = await requireAdmin(hs, h);
  const token = opts.token ?? linkToken();
  const id = linkId(token);
  const record: LinkRecord = { id, kind: 'telegram', status: 'offered', by: admin, at: opts.now ?? Date.now() };
  await hs.put(h, LINKS_LENS, record);
  return { token, id, record, payload: linkPayload(h, token) };
}

export interface LinkOffer {
  record: LinkRecord;
  /** The admin who signed it. */
  author: string;
}

/**
 * The offer `id` in `holon`, as signed by a key that was an ADMIN of the
 * holon at that moment — the newest such envelope. A plain read would hand
 * back the newest claim by any accepted member; only an admin may offer.
 * Syncs the holon's log and lens first, so a bot that never saw the holon
 * can judge it.
 */
export async function readLinkOffer(hs: HoloSphere, holon: string, id: string): Promise<LinkOffer | null> {
  const h = String(holon ?? '').trim();
  if (!isHolonId(h) || !isLinkId(id)) return null;
  const host = hs as Host;
  try {
    await hs.getMembers(h);
  } catch {
    return null; // not signing: nothing can be judged
  }
  host._readAuthority?.invalidate?.(h);
  try {
    await hs.get(h, LINKS_LENS, id);
  } catch {
    /* absent */
  }
  const actors = actorsFromMembersLog(await readMembersLog(hs, h));
  if (!actors) return null;
  const events = host.store
    .getEvents(h, LINKS_LENS, id)
    .filter((e) => actors.roleAt(String(e.pubkey).toLowerCase(), e.created_at) === 'admin')
    .sort((a, b) => b.created_at - a.created_at);
  for (const e of events) {
    const item = eventToItem(e as never) as unknown;
    if (isLinkRecord(item) && item.id === id) return { record: item, author: String(e.pubkey).toLowerCase() };
  }
  return null;
}

export type AcceptRefusal = 'not-holon' | 'no-offer' | 'stale' | 'wrong-state';

export interface AcceptInput {
  /** D, from the payload. */
  holon: string;
  token: string;
  /** The Telegram chat (T), as the bot sees it. */
  chat: ChatLike;
  /** The Telegram user who tapped the link (the bot has checked they admin the chat). */
  byUserId: string | number;
  now?: number;
}

export type AcceptResult = { ok: true; holon: string; chat: string; id: string; offerAuthor: string; record: LinkRecord } | { ok: false; refused: AcceptRefusal };

/**
 * Step 2, in the bot (signed by the chat's holon key): honour a link offer.
 * Founds the chat's holon when it is new, seats the offering admin in it,
 * writes the `accepted` record, and leaves a claim record so the screen
 * learns which chat answered. The caller checks the Telegram side (who
 * tapped, and that they admin the chat) before calling.
 */
export async function acceptTelegramLink(hs: HoloSphere, input: AcceptInput): Promise<AcceptResult> {
  const holon = String(input.holon ?? '').trim();
  if (!isHolonId(holon) || !isClaimToken(input.token)) return { ok: false, refused: 'not-holon' };
  const id = linkId(input.token);
  const offer = await readLinkOffer(hs, holon, id);
  if (!offer) return { ok: false, refused: 'no-offer' };
  if (offer.record.status !== 'offered') return { ok: false, refused: 'wrong-state' };
  const now = input.now ?? Date.now();
  if (!isFreshLink(offer.record, now)) return { ok: false, refused: 'stale' };
  // Single use: the same link tapped in a second chat must not seat the
  // admin there too. The claim record is the mark the first tap leaves.
  if (await readHolonClaim(hs, id, { now })) return { ok: false, refused: 'wrong-state' };

  const chat = String(input.chat.id ?? '').trim();
  // Found T when it is new and seat the offering admin — ours to sign since
  // the bot key is (or becomes) T's genesis. Never unseats anyone.
  await syncMembersLog(hs, chat, new Map<string, Role>([[offer.author, 'admin']]), { prune: false });
  try {
    const settings = await hs.get(chat, 'settings', chat);
    if (settings && typeof settings === 'object' && !Array.isArray(settings) && !(settings as { holonPubkey?: unknown }).holonPubkey) {
      await hs.put(chat, 'settings', { ...(settings as Record<string, unknown>), id: (settings as { id?: unknown }).id ?? chat, holonPubkey: me(hs) });
    }
  } catch {
    /* no settings yet: the genesis is the anchor */
  }
  const kind: HolonKind = input.chat.type === 'private' ? 'personal' : 'group';
  const title = kind === 'group' ? String(input.chat.title ?? '').trim() : [input.chat.first_name, input.chat.last_name].map((s) => String(s ?? '').trim()).filter(Boolean).join(' ');
  const record: LinkRecord = {
    id,
    kind: 'telegram',
    status: 'accepted',
    peer: holon,
    peerAnchor: offer.author,
    by: String(input.byUserId),
    chat: title ? { id: chat, kind, title } : { id: chat, kind },
    at: now,
  };
  await hs.put(chat, LINKS_LENS, record);
  await recordHolonClaim(hs, id, input.chat, now);
  (hs as Host)._readAuthority?.invalidate?.(chat);
  return { ok: true, holon, chat, id, offerAuthor: offer.author, record };
}

export interface LinkAccept {
  chat: string;
  record: LinkRecord;
  /** The chat holon's anchor — the key that signed the acceptance. */
  anchor: string;
}

/**
 * Step 3a, on the screen: the acceptance for `id` in `chat`, if the chat's
 * ANCHOR signed it and it names `holon`. This is the check that makes the
 * claim record trustworthy: a claim only points at a chat; the chat's own
 * signed record is what the screen believes.
 */
export async function readLinkAccept(hs: HoloSphere, input: { holon: string; id: string; chat: string }): Promise<LinkAccept | null> {
  const chat = String(input.chat ?? '').trim();
  if (!chat || !isLinkId(input.id)) return null;
  try {
    await hs.getMembers(chat);
  } catch {
    /* not signing */
  }
  try {
    await hs.get(chat, LINKS_LENS, input.id);
  } catch {
    /* absent */
  }
  const host = hs as Host;
  host._readAuthority?.invalidate?.(chat);
  const anchor = resolveHolonAuthority(hs, chat).anchor ?? holonAnchor(host.store, chat);
  if (!anchor) return null;
  const item = itemByAuthor(host.store, chat, LINKS_LENS, input.id, anchor);
  if (!isLinkRecord(item) || item.status !== 'accepted' || item.peer !== input.holon) return null;
  return { chat, record: item, anchor };
}

/**
 * Step 3b, on the screen, after a human confirmed the chat: mark the link
 * `linked` and seat the chat's anchor (the bot key) as an admin of the
 * holon. Idempotent for the same chat.
 */
export async function completeTelegramLink(hs: HoloSphere, input: { holon: string; id: string; chat: string; anchor: string; name?: string; now?: number }): Promise<LinkRecord> {
  const holon = String(input.holon ?? '').trim();
  await requireAdmin(hs, holon);
  if (!HEX64.test(input.anchor)) throw new Error('completeTelegramLink: the chat anchor must be a pubkey');
  const current = await readOwn(hs, holon, input.id);
  if (!current) throw new Error('No offer of ours to complete.');
  if (current.status === 'linked' && current.peer === input.chat) return current;
  if (!nextLinkState(current.status, 'complete')) throw new Error(`Cannot complete a link that is ${current.status}.`);
  const record: LinkRecord = { ...current, status: 'linked', peer: input.chat, peerAnchor: input.anchor.toLowerCase(), at: input.now ?? Date.now() };
  const name = String(input.name ?? '').trim();
  if (name) record.name = name;
  await hs.put(holon, LINKS_LENS, record);
  await addHolonMember(hs, holon, record.peerAnchor!, 'admin');
  return record;
}

/** Step 4, on the screen: drop the link and unseat the chat's key. */
export async function unlinkTelegram(hs: HoloSphere, holon: string, id: string, now = Date.now()): Promise<LinkRecord | null> {
  const h = String(holon ?? '').trim();
  await requireAdmin(hs, h);
  const current = await readOwn(hs, h, id);
  if (!current || !nextLinkState(current.status, 'unlink')) return null;
  const record: LinkRecord = { ...current, status: 'unlinked', at: now };
  await hs.put(h, LINKS_LENS, record);
  if (current.peerAnchor) {
    try {
      await removeHolonMember(hs, h, current.peerAnchor);
    } catch {
      /* not seated (any more) */
    }
  }
  return record;
}

/** Step 4, in the bot: drop the link from the chat's side and unseat the holon's admin. */
export async function unlinkChat(hs: HoloSphere, chat: string, id: string, now = Date.now()): Promise<LinkRecord | null> {
  const c = String(chat ?? '').trim();
  const current = await readOwn(hs, c, id);
  if (!current || !nextLinkState(current.status, 'unlink')) return null;
  const record: LinkRecord = { ...current, status: 'unlinked', at: now };
  await hs.put(c, LINKS_LENS, record);
  if (current.peerAnchor) await hs.removeMember(c, current.peerAnchor, { at: await nextMembersAt(hs, c) });
  (hs as Host)._readAuthority?.invalidate?.(c);
  return record;
}

// ── Reading the links ──────────────────────────────────────────────────────

/** The chats linked to `holon` (the holon's own `linked` records, as the authorized read shows them). */
export async function linkedTelegramChats(hs: HoloSphere, holon: string): Promise<LinkRecord[]> {
  let raw: unknown;
  try {
    raw = await hs.getAll(holon, LINKS_LENS);
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
  return list.filter((r): r is LinkRecord => isLinkRecord(r) && r.kind === 'telegram' && r.status === 'linked').sort((a, b) => b.at - a.at);
}

/** The holons `chat` accepted a link from — only records its anchor signed. */
export async function linkedHolons(hs: HoloSphere, chat: string): Promise<LinkRecord[]> {
  const c = String(chat ?? '').trim();
  if (!c) return [];
  try {
    await hs.getAll(c, LINKS_LENS);
  } catch {
    /* keep whatever the store holds */
  }
  const host = hs as Host;
  const anchor = holonAnchor(host.store, c);
  if (!anchor) return [];
  return (itemsByAuthor(host.store, c, LINKS_LENS, anchor) as unknown[])
    .filter((r): r is LinkRecord => isLinkRecord(r) && r.status === 'accepted' && !!r.peer)
    .sort((a, b) => b.at - a.at);
}

/**
 * The keys a chat's links seat as admins (each accepted link's offering
 * admin), for the bot's roster sync: without them a prune would unseat
 * the dashboard admin on the next refresh.
 */
export async function linkedAdmins(hs: HoloSphere, chat: string): Promise<Map<string, Role>> {
  const out = new Map<string, Role>();
  for (const r of await linkedHolons(hs, chat)) if (r.peerAnchor) out.set(r.peerAnchor.toLowerCase(), 'admin');
  return out;
}

/**
 * Bring the chat's members into every holon it is linked to — only where
 * this key (the bot's) is already seated as an admin there, and never
 * founding or pruning. Returns the holons that were synced.
 */
export async function bridgeTelegramRoster(hs: HoloSphere, chat: string, memberKeys: Iterable<string>): Promise<string[]> {
  const key = me(hs);
  const desired = new Map<string, Role>();
  for (const k of memberKeys) if (HEX64.test(k) && k.toLowerCase() !== key) desired.set(k.toLowerCase(), 'member');
  const synced: string[] = [];
  for (const link of await linkedHolons(hs, chat)) {
    const holon = String(link.peer);
    let seated: Map<string, string>;
    try {
      seated = await hs.getMembers(holon);
    } catch {
      continue;
    }
    if (seated.get(key) !== 'admin') continue;
    // Keep the holon's own admins as they are: only add what is missing.
    const want = new Map<string, Role>();
    for (const [k, role] of seated) want.set(k, role === 'admin' ? 'admin' : 'member');
    for (const [k, role] of desired) if (!want.has(k)) want.set(k, role);
    await syncMembersLog(hs, holon, want, { prune: false, founding: false });
    (hs as Host)._readAuthority?.invalidate?.(holon);
    synced.push(holon);
  }
  return synced;
}

// ── The wait, and what a link means for the boards ─────────────────────────

/**
 * Watch for the bot's answer to an offer: the claim record names the chat,
 * and the chat's own signed acceptance (by its anchor, naming this holon)
 * is what is handed on. The acceptance can land a beat after the claim, so
 * the read is retried for a while; a claim whose acceptance never verifies
 * is reported through `onFailed`. Fires at most once; returns a stop.
 */
export function watchTelegramLink(
  hs: (HoloSphere & ClaimWatchStore) | Promise<HoloSphere & ClaimWatchStore>,
  pending: { holon: string; id: string },
  onAccepted: (accept: LinkAccept) => void,
  opts: {
    pollMs?: number;
    /** Retries of the acceptance read after the claim (default 8, 1.5 s apart). */
    retries?: number;
    retryMs?: number;
    onFailed?: (chat: string) => void;
    /** Test seam: the acceptance read. */
    read?: (hs: HoloSphere, chat: string) => Promise<LinkAccept | null>;
  } = {},
): () => void {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const read = opts.read ?? ((h: HoloSphere, chat: string) => readLinkAccept(h, { holon: pending.holon, id: pending.id, chat }));
  const retries = opts.retries ?? 8;
  const retryMs = opts.retryMs ?? 1500;
  const stopClaim = watchHolonClaim(
    hs,
    pending.id,
    (claim) => {
      let attempt = 0;
      const tryRead = async () => {
        if (!active) return;
        let accept: LinkAccept | null = null;
        try {
          accept = await read(await hs, claim.holon);
        } catch {
          accept = null;
        }
        if (!active) return;
        if (accept) {
          active = false;
          onAccepted(accept);
          return;
        }
        if (attempt++ < retries) timer = setTimeout(() => void tryRead(), retryMs);
        else {
          active = false;
          opts.onFailed?.(claim.holon);
        }
      };
      void tryRead();
    },
    { pollMs: opts.pollMs },
  );
  return () => {
    active = false;
    if (timer) clearTimeout(timer);
    stopClaim();
  };
}

/** Every lens the two holons exchange once linked: everything the boards show. */
export const LINKED_LENSES = ['quests', 'library', 'roles', 'checklists', 'stock', 'offers', 'needs', 'announcements', 'shopping', 'expenses'];

/** Federate the linked pair both ways on every board lens (idempotent). */
export async function federateLinkedChat(hs: HoloSphere, holon: string, chat: string, name?: string): Promise<void> {
  await setFederationPartner(hs, holon, chat, { inbound: LINKED_LENSES, outbound: LINKED_LENSES, partnerName: name || undefined });
}

/** Undo `federateLinkedChat`. */
export async function unfederateLinkedChat(hs: HoloSphere, holon: string, chat: string): Promise<void> {
  await removeFederationPartner(hs, holon, chat);
}
