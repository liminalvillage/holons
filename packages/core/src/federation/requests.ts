// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Federation requests — how a link reaches the other side.
//
// A federation link has two halves. Each holon's record says which lenses IT
// receives from a partner and sends to it, and that record counts only when
// one of the holon's admins signed it (capabilities.js, `federation`). So an
// admin of A can set A's half, never B's: B's half is B's admins' word.
//
// When A's admin links A ↔ B and cannot speak for B, A's half is written and
// B is ASKED: a record in B's `fedrequests` lens, id = A, carrying the
// directions B is asked to adopt, from B's point of view (`kind: 'link'`), or
// asking B to drop its half because A ended the link (`kind: 'unlink'`). B's admins see it on every surface —
// the bot posts it in B's group with Accept / Decline, the kiosk and the web
// list it — and answering writes B's own record (`answerFederationRequest`).
//
// Who counts: the record is written by A's admins (pending, cancelled) and
// B's admins (announced, accepted, declined); a record signed by anyone else
// is ignored, so nobody can ask on A's behalf. The newest counting record
// wins. A request B already satisfies is not pending, whatever it says.

import type { HoloSphere } from 'holosphere';
import { eventToItem } from 'holosphere/nostr-events.js';
import { verifyEvent } from 'nostr-tools/pure';
import { resolveHolonAuthority, writeAcceptance } from '../holosphere/authority.js';
import { may } from '../holosphere/capabilities.js';
import type { NostrEventLike } from '../nostr/types.js';
import type { FederationLensDirections } from './snapshot.js';

/** The lens, in the ASKED holon, holding one request per asking holon. */
export const FEDERATION_REQUESTS_LENS = 'fedrequests';

/** The Holosphere envelope kind the lens rides on. */
const ENVELOPE_KIND = 30078;
const DEFAULT_APP = 'Holons';

export type FederationRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

/** What a holon was asked by a partner (id = the asking holon). */
export interface FederationRequest {
  id: string;
  /** The asking holon. */
  from: string;
  /** The asked holon. */
  to: string;
  /** Adopt the directions below, or drop the half that names `from`. */
  kind: 'link' | 'unlink';
  /** Lenses `to` is asked to RECEIVE from `from`. */
  inbound: string[];
  /** Lenses `to` is asked to SEND to `from`. Both may be empty: a link with no flows yet. */
  outbound: string[];
  /** Scalespace reach, carried as-is when `from` is an H3 cell. */
  hops?: number;
  /** The asking holon's name, as the asker knew it. */
  fromName?: string;
  status: FederationRequestStatus;
  /** Unix seconds of the proposal this record is about. */
  proposedAt: number;
  /** Unix seconds of the last change. */
  at: number;
  /** Where a surface announced it (a Telegram message id). */
  messageId?: number;
  /** Who settled it, in the surface's own terms (a Telegram user id). */
  by?: string;
  /** The key that signed the record that counts — read off the envelope, never stored. */
  signer?: string;
  /** Unix seconds that envelope was signed. */
  signedAt?: number;
}

type StoreHost = HoloSphere & {
  store: {
    listEventIds(holon: string | null, lens: string): string[];
    getEvents(holon: string | null, lens: string, id: string): Array<{ pubkey: string; created_at: number; id?: string }>;
  };
  _relaySync?: (holon: string, lens: string, opts?: { await?: boolean }) => Promise<unknown>;
  _readAuthority?: { invalidate(holon?: string): void };
  appname?: string;
};

const nowSec = (): number => Math.floor(Date.now() / 1000);

/** Lens directions as two sorted, deduped arrays. */
export function normalizeDirections(dirs: Partial<FederationLensDirections> | null | undefined): FederationLensDirections {
  const clean = (arr: unknown) =>
    [...new Set((Array.isArray(arr) ? arr : []).filter((l): l is string => typeof l === 'string' && l.trim() !== '').map((l) => l.trim()))].sort();
  return { inbound: clean(dirs?.inbound), outbound: clean(dirs?.outbound) };
}

/** The same lens flows, whatever the order. */
export function sameDirections(a: Partial<FederationLensDirections> | null | undefined, b: Partial<FederationLensDirections> | null | undefined): boolean {
  const x = normalizeDirections(a);
  const y = normalizeDirections(b);
  return x.inbound.join('\n') === y.inbound.join('\n') && x.outbound.join('\n') === y.outbound.join('\n');
}

/** The other side's view of a link: what one side sends, the other receives. */
export function mirrorDirections(dirs: Partial<FederationLensDirections>): FederationLensDirections {
  const d = normalizeDirections(dirs);
  return { inbound: d.outbound, outbound: d.inbound };
}

async function syncLog(hs: HoloSphere, holon: string): Promise<void> {
  const host = hs as StoreHost;
  try {
    await host._relaySync?.(holon, '_members', { await: true });
  } catch {
    /* offline: the store decides */
  }
}

/** May `pubkey`, as of `at`, speak for `holon`'s federation? A holon nobody speaks for is open. */
function federationVoice(hs: HoloSphere, holon: string): (pubkey: string, at: number) => boolean {
  const { actors } = resolveHolonAuthority(hs, holon);
  if (!actors) return () => true;
  return (pubkey, at) => may(actors.roleAt(String(pubkey).toLowerCase(), at), 'federation');
}

/**
 * The requests that count in `holon`, by asking holon: for each, the newest
 * record signed by an admin of the asker or of `holon` (as of its time).
 */
export async function federationRequestRecords(hs: HoloSphere, holon: string): Promise<Map<string, FederationRequest>> {
  const host = hs as StoreHost;
  const to = String(holon);
  const out = new Map<string, FederationRequest>();
  try {
    await host._relaySync?.(to, FEDERATION_REQUESTS_LENS, { await: true });
  } catch {
    /* nothing readable: what the store holds decides */
  }
  const ids = host.store.listEventIds(to, FEDERATION_REQUESTS_LENS).map(String);
  if (!ids.length) return out;
  await Promise.all([to, ...ids].map((h) => syncLog(hs, h)));
  const asked = federationVoice(hs, to);
  for (const from of ids) {
    if (from === to) continue;
    const asker = federationVoice(hs, from);
    const newest = host.store
      .getEvents(to, FEDERATION_REQUESTS_LENS, from)
      .filter((e) => asked(e.pubkey, e.created_at) || asker(e.pubkey, e.created_at))
      .sort((a, b) => b.created_at - a.created_at || (String(a.id) < String(b.id) ? 1 : -1))[0];
    if (!newest) continue;
    const item = eventToItem(newest as never) as (FederationRequest & { _deleted?: boolean }) | null;
    if (!item || item._deleted === true) continue;
    if (String(item.from) !== from || String(item.to) !== to) continue;
    out.set(from, {
      ...item,
      id: from,
      from,
      to,
      kind: item.kind === 'unlink' ? 'unlink' : 'link',
      ...normalizeDirections(item),
      signer: String(newest.pubkey).toLowerCase(),
      signedAt: newest.created_at,
    });
  }
  return out;
}

/** `holon`'s own counted config for `partner`, or null when its record does not list it. */
export async function counterpartConfig(hs: HoloSphere, holon: string, partner: string): Promise<FederationLensDirections | null> {
  const standing = await (hs as any).getFederationStanding?.(holon).catch(() => null);
  const record = standing ? standing.record : await (hs as any).getFederation?.(holon).catch(() => null);
  if (!record || !Array.isArray(record.federated) || !record.federated.map(String).includes(String(partner))) return null;
  return normalizeDirections(record.lensConfig?.[partner] ?? {});
}

/** Does `holon` already do what the request asks? */
async function satisfied(hs: HoloSphere, request: FederationRequest): Promise<boolean> {
  const current = await counterpartConfig(hs, request.to, request.from);
  if (request.kind === 'unlink') return current === null;
  return current !== null && sameDirections(current, request);
}

/** The requests waiting for `holon`'s admins, newest first. Requests it already satisfies are left out. */
export async function pendingFederationRequests(hs: HoloSphere, holon: string): Promise<FederationRequest[]> {
  const out: FederationRequest[] = [];
  for (const r of (await federationRequestRecords(hs, holon)).values()) {
    if (r.status !== 'pending') continue;
    if (await satisfied(hs, r)) continue;
    out.push(r);
  }
  return out.sort((a, b) => b.proposedAt - a.proposedAt);
}

export interface AskFederationInput {
  /** 'unlink' asks `to` to drop its half; the directions are then ignored. */
  kind?: 'link' | 'unlink';
  /** What `to` is asked to adopt, from `to`'s point of view. */
  directions?: Partial<FederationLensDirections>;
  hops?: number;
  fromName?: string;
  now?: () => number;
}

/** Ask `to`'s admins to adopt a half of the link with `from`. Counts only from an admin of `from`. */
export async function askFederation(hs: HoloSphere, from: string, to: string, input: AskFederationInput): Promise<FederationRequest> {
  const at = (input.now ?? nowSec)();
  const record: FederationRequest = {
    id: String(from),
    from: String(from),
    to: String(to),
    kind: input.kind ?? 'link',
    ...normalizeDirections(input.kind === 'unlink' ? null : input.directions),
    ...(input.hops && input.hops > 0 ? { hops: input.hops } : {}),
    ...(input.fromName ? { fromName: input.fromName } : {}),
    status: 'pending',
    proposedAt: at,
    at,
  };
  await hs.put(String(to), FEDERATION_REQUESTS_LENS, record as never);
  return record;
}

/** Rewrite a request the store holds with new fields (status, announcement). */
async function rewrite(hs: HoloSphere, current: FederationRequest, patch: Partial<FederationRequest>, now?: () => number): Promise<FederationRequest> {
  const { signer: _signer, signedAt: _signedAt, ...stored } = current;
  const record: FederationRequest = { ...stored, ...patch, at: (now ?? nowSec)() };
  await hs.put(current.to, FEDERATION_REQUESTS_LENS, record as never);
  return record;
}

/** The asker withdraws its pending request (it was satisfied another way, or the link went). */
export async function cancelFederationRequest(hs: HoloSphere, from: string, to: string, opts: { now?: () => number } = {}): Promise<FederationRequest | null> {
  const cur = (await federationRequestRecords(hs, to)).get(String(from));
  if (!cur || cur.status !== 'pending') return null;
  return rewrite(hs, cur, { status: 'cancelled' }, opts.now);
}

/** Remember where a surface announced a request (an admin of the asked holon writes it). */
export async function markFederationRequestAnnounced(
  hs: HoloSphere,
  to: string,
  from: string,
  messageId: number,
  opts: { now?: () => number } = {},
): Promise<FederationRequest | null> {
  const cur = (await federationRequestRecords(hs, to)).get(String(from));
  if (!cur || cur.status !== 'pending') return null;
  return rewrite(hs, cur, { messageId }, opts.now);
}

// ── One side of a link ─────────────────────────────────────────────────────

/** Write `holon`'s half of the link: its record only, never the partner's. */
export async function writeOwnSide(
  hs: HoloSphere,
  holon: string,
  partner: string,
  dirs: Partial<FederationLensDirections>,
  opts: { partnerName?: string; hops?: number } = {},
): Promise<void> {
  const d = normalizeDirections(dirs);
  const h = hs as any;
  await h.federate(holon, partner, null, null, false, { inbound: d.inbound, outbound: d.outbound, hops: opts.hops });
  if (opts.partnerName) {
    try {
      const standing = await h.getFederationStanding?.(holon);
      const info = (standing ? (standing.record ?? standing.raw) : await h.getFederation(holon)) ?? null;
      if (info && info.partnerNames?.[partner] !== opts.partnerName) {
        info.partnerNames = { ...(info.partnerNames ?? {}), [partner]: opts.partnerName };
        await h.putGlobal('federation', info);
      }
    } catch {
      /* the name is cosmetic */
    }
  }
}

/** Drop `holon`'s half of the link: its record only. */
export async function removeOwnSide(hs: HoloSphere, holon: string, partner: string): Promise<void> {
  await (hs as any).unfederate(holon, partner, null, null, false);
}

// ── Answering ──────────────────────────────────────────────────────────────

export interface AnswerFederationOptions {
  /** Adopt these directions instead of the asked ones (an admin trimming lenses). */
  directions?: Partial<FederationLensDirections>;
  /** Who answered, in the surface's own terms. */
  by?: string | number;
  now?: () => number;
}

/**
 * Accept or decline the request `from` made of `holon`. Accepting writes
 * `holon`'s own half (or drops it, for an unlink); the asker's half is
 * already theirs. Needs an admin of `holon`. Null when no request is held.
 */
export async function answerFederationRequest(
  hs: HoloSphere,
  holon: string,
  from: string,
  decision: 'accept' | 'decline',
  opts: AnswerFederationOptions = {},
): Promise<FederationRequest | null> {
  const cur = (await federationRequestRecords(hs, holon)).get(String(from));
  if (!cur) return null;
  if (decision === 'accept') {
    if (cur.kind === 'unlink') await removeOwnSide(hs, holon, from);
    else await writeOwnSide(hs, holon, from, normalizeDirections(opts.directions ?? cur), { partnerName: cur.fromName, hops: cur.hops });
  }
  return rewrite(
    hs,
    cur,
    { status: decision === 'accept' ? 'accepted' : 'declined', ...(opts.by !== undefined ? { by: String(opts.by) } : {}) },
    opts.now,
  );
}

/**
 * Accept the pending requests this key asked of `holon` itself: the signer
 * spoke for the asking holon then and speaks for `holon` now, so both halves
 * are already its word — usually a link made before it was `holon`'s admin.
 * Only a request THIS key signed: another admin's ask still waits for a
 * person. A service key that asks on purpose (the bot's `askPartner`) must
 * not call this. Returns the requests it accepted.
 */
export async function settleOwnFederationRequests(
  hs: HoloSphere,
  holon: string,
  opts: { now?: () => number } = {},
): Promise<FederationRequest[]> {
  const me = String((hs as StoreHost & { currentPubkey?: string }).currentPubkey ?? '').toLowerCase();
  if (!me) return [];
  const mine = (await pendingFederationRequests(hs, holon)).filter((r) => r.signer === me);
  if (!mine.length) return [];
  try {
    if (!may(await writeAcceptance(hs, holon), 'federation')) return [];
  } catch {
    return [];
  }
  const settled: FederationRequest[] = [];
  for (const r of mine) {
    if (!federationVoice(hs, r.from)(me, r.signedAt ?? 0)) continue;
    const done = await answerFederationRequest(hs, holon, r.from, 'accept', { by: 'self', now: opts.now });
    if (done) settled.push(done);
  }
  return settled;
}

// ── Where a link stands ────────────────────────────────────────────────────

export interface FederationLinkState {
  /** `holon`'s counted half, or null when it does not list the partner. */
  ours: FederationLensDirections | null;
  /** The partner's counted half, mirrored into `holon`'s point of view. */
  theirs: FederationLensDirections | null;
  /** `holon`'s request still waiting in the partner. */
  outgoing: FederationRequest | null;
  /** The partner's request waiting for `holon`'s admins. */
  incoming: FederationRequest | null;
}

/** Both halves of a link and the requests between them, from `holon`'s side. */
export async function federationLinkState(hs: HoloSphere, holon: string, partner: string): Promise<FederationLinkState> {
  const [ours, theirsRaw, outRecs, inRecs] = await Promise.all([
    counterpartConfig(hs, holon, partner),
    counterpartConfig(hs, partner, holon),
    federationRequestRecords(hs, partner),
    federationRequestRecords(hs, holon),
  ]);
  const theirs = theirsRaw ? mirrorDirections(theirsRaw) : null;
  const out = outRecs.get(String(holon)) ?? null;
  const inc = inRecs.get(String(partner)) ?? null;
  const outgoing = out && out.status === 'pending' && !(await satisfied(hs, out)) ? out : null;
  const incoming = inc && inc.status === 'pending' && !(await satisfied(hs, inc)) ? inc : null;
  return { ours, theirs, outgoing, incoming };
}

/**
 * Per lens and direction (from `holon`'s side): is the flow agreed by both
 * halves, waiting for the partner, or off? A flow the partner offers but
 * `holon` has not taken is 'offered'.
 */
export function laneState(state: Pick<FederationLinkState, 'ours' | 'theirs'>, lens: string, dir: 'in' | 'out'): 'agreed' | 'waiting' | 'offered' | 'off' {
  const key = dir === 'in' ? 'inbound' : 'outbound';
  const mine = !!state.ours?.[key].includes(lens);
  const theirs = !!state.theirs?.[key].includes(lens);
  if (mine && theirs) return 'agreed';
  if (mine) return 'waiting';
  if (theirs) return 'offered';
  return 'off';
}

// ── Watching every holon's requests (a service answering for many) ─────────

/** A request event as it arrived — the claim only; read the record that counts with `federationRequestRecords`. */
export interface FederationRequestSighting {
  to: string;
  from: string;
  eventId: string;
  pubkey: string;
  at: number;
}

/**
 * Every federation request of the namespace, whatever holon it asks — ONE
 * relay filter, for a service that answers for many holons (the bot). Each
 * verified envelope is handed over as a sighting; the listener reads the
 * counted record itself. Returns a stop function.
 */
export function watchAllFederationRequests(
  hs: HoloSphere,
  opts: { appName?: string; since?: number },
  onSighting: (s: FederationRequestSighting) => void,
): () => void {
  const filter: Record<string, unknown> = {
    kinds: [ENVELOPE_KIND],
    '#l': [FEDERATION_REQUESTS_LENS],
    '#n': [opts.appName ?? (hs as StoreHost).appname ?? DEFAULT_APP],
  };
  if (typeof opts.since === 'number' && opts.since > 0) filter.since = Math.floor(opts.since);
  return (hs as any).subscribeNostr(filter, (event: NostrEventLike) => {
    if (!event || event.kind !== ENVELOPE_KIND || !event.id || !event.sig) return;
    const to = (event.tags ?? []).find((t) => t[0] === 'h')?.[1];
    const d = (event.tags ?? []).find((t) => t[0] === 'd')?.[1];
    if (!to || !d) return;
    const from = d.slice(`${to}/${FEDERATION_REQUESTS_LENS}/`.length);
    if (!from || !d.startsWith(`${to}/${FEDERATION_REQUESTS_LENS}/`)) return;
    const { id, pubkey, kind, created_at, tags, content, sig } = event;
    try {
      if (!verifyEvent({ id, pubkey, kind, created_at, tags, content, sig } as never)) return;
    } catch {
      return;
    }
    onSighting({ to, from, eventId: event.id, pubkey: String(event.pubkey).toLowerCase(), at: event.created_at });
  });
}
