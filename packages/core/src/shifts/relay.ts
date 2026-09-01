// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Relay I/O for the shift protocol. Thin: a `ShiftRelayClient` wraps any
// pool with `querySync`/`publish` (nostr-tools `SimplePool` by default) and
// returns parsed, resolved domain objects. Signing happens only through a
// caller-supplied `NostrSigner` — no private key ever reaches this module.

import type { Event } from 'nostr-tools/pure';
import type { NostrSigner } from '../holosphere/signers.js';
import {
  buildRsvpTemplate,
  latestRsvpFor,
  occurrenceFilter,
  parseShiftOccurrence,
  parseShiftRsvp,
  participantRsvpFilter,
  resolveRsvps,
  rsvpFilter,
  rsvpSupersedes,
  sortOccurrences,
  type BuildRsvpOptions,
  type NostrFilterLike,
  type ShiftIdentityMap,
} from './protocol.js';
import type { ShiftOccurrence, ShiftRsvp } from './types.js';
import {
  attestationFilter,
  attestationIdentityMap,
  parseIdentityAttestation,
  resolveAttestations,
  type AttestationFilterOptions,
  type IdentityAttestation,
} from './attestation.js';

/** Parameters our live subscriptions hand to the pool (nostr-tools shape). */
export interface ShiftPoolSubscribeParams {
  onevent?: (event: Event) => void;
  /** Fired once when every relay has sent EOSE (or `maxWait` elapsed). */
  oneose?: () => void;
  onclose?: (reasons: string[]) => void;
  maxWait?: number;
}

export interface ShiftPoolSubscription {
  close(reason?: string): void;
}

/** The subset of nostr-tools' `SimplePool` we rely on (injectable for tests). */
export interface ShiftPoolLike {
  querySync(relays: string[], filter: NostrFilterLike, params?: { maxWait?: number }): Promise<Event[]>;
  publish(relays: string[], event: Event): Promise<string>[];
  /** Live REQ subscription — required only by `subscribeSchedule`. */
  subscribe?(relays: string[], filter: NostrFilterLike, params: ShiftPoolSubscribeParams): ShiftPoolSubscription;
  close?(relays: string[]): void;
}

export interface ShiftRelayClientOptions {
  relays: string[];
  /** Coordinator pubkey; when set, only its occurrences are trusted. */
  coordinatorPubkey?: string;
  pool?: ShiftPoolLike;
  /** Per-query wait cap in ms (default 6000). */
  maxWait?: number;
}

export interface ShiftSchedule {
  occurrences: ShiftOccurrence[];
  /** Resolved RSVPs (winner per author × address). */
  rsvps: ShiftRsvp[];
}

export interface ShiftScheduleRange {
  since?: number;
  until?: number;
}

/**
 * One live emission: the schedule plus the kind-31926 attestations for its
 * participants, so a single subscription feeds occurrences, RSVPs, display
 * names AND the person-identity collapse (via `attestationNameMap` /
 * `attestationIdentityMap`).
 */
export interface ShiftScheduleUpdate extends ShiftSchedule {
  /** Resolved attestations (winner per provider × identifier). */
  attestations: IdentityAttestation[];
}

export interface SubscribeScheduleOptions {
  /**
   * Occurrence window by shift start/end (same semantics as
   * `fetchOccurrences`). Pass a function for a sliding window — it is
   * re-evaluated at every emission, so old shifts fall out and stored
   * future ones slide in without re-subscribing.
   */
  range?: ShiftScheduleRange | (() => ShiftScheduleRange);
  /**
   * The resolved schedule + attestations: once after the stored backlog
   * has drained (EOSE on all subscriptions), then again on every relevant
   * event the relays push.
   */
  onSchedule: (schedule: ShiftScheduleUpdate) => void;
  onError?: (err: unknown) => void;
  /** Debounce for bursts of pushed events, ms (default 250). */
  debounceMs?: number;
}

export interface ShiftScheduleSubscription {
  close(): void;
}

export interface ShiftRelayClient {
  readonly relays: string[];
  /** Occurrences for a group in `[since, until]` (unix seconds, by shift start). */
  fetchOccurrences(groupId: string, range?: { since?: number; until?: number }): Promise<ShiftOccurrence[]>;
  /** Resolved RSVPs for the given occurrences. */
  fetchRsvps(occurrences: ShiftOccurrence[]): Promise<ShiftRsvp[]>;
  /** Occurrences + resolved RSVPs in one call. */
  fetchSchedule(groupId: string, range?: { since?: number; until?: number }): Promise<ShiftSchedule>;
  /**
   * Live view of a group's schedule: relay subscriptions for the
   * occurrences, their RSVPs and the participants' kind-31926
   * attestations, resolved together and pushed to `onSchedule` as events
   * arrive — the ONE feed for everything a shift board shows. Needs a
   * pool with `subscribe` (the default `SimplePool` qualifies, with
   * auto-reconnect on). `close()` tears every subscription down.
   */
  subscribeSchedule(groupId: string, opts: SubscribeScheduleOptions): ShiftScheduleSubscription;
  /** One participant's resolved RSVPs. */
  fetchParticipantRsvps(pubkey: string): Promise<ShiftRsvp[]>;
  /**
   * Kind-31926 identity attestations, resolved newest-per-(provider, d).
   * Read-only: publishing attestations is the projection layer's job.
   */
  fetchAttestations(opts: AttestationFilterOptions): Promise<IdentityAttestation[]>;
  /**
   * Sign and publish a signup/cancellation as `signer` (the participant).
   * Looks up the PERSON's previous RSVP — the signer's own plus any
   * attestation-linked sibling key's (kind 31926) — so `created_at` strictly
   * increases past all of them and the event wins the person-level
   * resolution. Pass `identity` to skip the attestation lookup, or
   * `previous` to skip both. Resolves with the signed event and per-relay
   * outcomes.
   */
  publishRsvp(
    opts: Omit<BuildRsvpOptions, 'previous'> & {
      signer: NostrSigner;
      previous?: ShiftRsvp;
      identity?: ShiftIdentityMap;
    },
  ): Promise<{ event: Event; results: PromiseSettledResult<string>[] }>;
  close(): void;
}

async function defaultPool(): Promise<ShiftPoolLike> {
  const pool = await import('nostr-tools/pool');
  // Node < 22 (e.g. a serverless runtime) has no global WebSocket, and
  // nostr-tools then reports every publish as "connection failure" without
  // ever reaching a relay — hand it the `ws` implementation instead. In the
  // browser this branch is dead code (ws's browser build is an inert stub).
  if ((globalThis as { WebSocket?: unknown }).WebSocket === undefined) {
    const { default: WS } = await import('ws');
    pool.useWebSocketImplementation(WS as never);
  }
  // Reconnect keeps subscribeSchedule live across relay drops: nostr-tools
  // reopens the socket and re-fires the open subscriptions.
  return new pool.SimplePool({ enableReconnect: true }) as unknown as ShiftPoolLike;
}

export function createShiftRelayClient(options: ShiftRelayClientOptions): ShiftRelayClient {
  const relays = options.relays.map((r) => r.trim()).filter(Boolean);
  if (!relays.length) throw new Error('createShiftRelayClient: at least one relay is required');
  const maxWait = options.maxWait ?? 6000;
  let poolPromise: Promise<ShiftPoolLike> | null = options.pool ? Promise.resolve(options.pool) : null;
  const pool = () => (poolPromise ??= defaultPool());

  async function query(filter: NostrFilterLike): Promise<Event[]> {
    const p = await pool();
    return p.querySync(relays, filter, { maxWait });
  }

  async function fetchOccurrences(groupId: string, range: { since?: number; until?: number } = {}) {
    // `since`/`until` on the REQ filter would apply to created_at, not to
    // the shift's start — occurrences are published days ahead, so we filter
    // on the parsed `start` client-side instead.
    const events = await query(occurrenceFilter({ groupId, coordinatorPubkey: options.coordinatorPubkey }));
    const seen = new Map<string, ShiftOccurrence>();
    for (const ev of events) {
      const occ = parseShiftOccurrence(ev);
      if (!occ || occ.groupId !== groupId) continue;
      if (range.since !== undefined && occ.end < range.since) continue;
      if (range.until !== undefined && occ.start > range.until) continue;
      const prev = seen.get(occ.address);
      if (!prev || occ.createdAt > prev.createdAt) seen.set(occ.address, occ);
    }
    return sortOccurrences([...seen.values()]);
  }

  async function fetchRsvps(occurrences: ShiftOccurrence[]) {
    if (!occurrences.length) return [];
    const events = await query(rsvpFilter(occurrences.map((o) => o.address)));
    const parsed = events.map(parseShiftRsvp).filter((r): r is ShiftRsvp => r !== null);
    return [...resolveRsvps(parsed).values()];
  }

  async function fetchAttestations(opts: AttestationFilterOptions) {
    const events = await query(attestationFilter(opts));
    const wantAuthors = opts.authors?.map((a) => a.toLowerCase());
    const wantIds = opts.identifiers;
    const wantPks = opts.participants?.map((p) => p.toLowerCase());
    const parsed = events
      .map(parseIdentityAttestation)
      // Re-apply the filter client-side — a relay that ignores `#d`/`#p`
      // must degrade to extra bytes, never to wrong entries.
      .filter((a): a is IdentityAttestation => {
        if (!a) return false;
        if (wantAuthors && !wantAuthors.includes(a.provider.toLowerCase())) return false;
        if (wantIds && !wantIds.includes(a.identifier)) return false;
        if (wantPks && !a.pubkeys.some((pk) => wantPks.includes(pk))) return false;
        return true;
      });
    return [...resolveAttestations(parsed).values()];
  }

  function subscribeSchedule(groupId: string, opts: SubscribeScheduleOptions): ShiftScheduleSubscription {
    const rangeOf =
      typeof opts.range === 'function' ? opts.range : () => (opts.range as ShiftScheduleRange | undefined) ?? {};
    const debounceMs = opts.debounceMs ?? 250;

    const occs = new Map<string, ShiftOccurrence>(); // address → newest occurrence
    const winners = new Map<string, ShiftRsvp>(); // `${pubkey}\0${address}` → winning RSVP
    const atts = new Map<string, IdentityAttestation>(); // `${provider}\0${identifier}` → winner
    let occSub: ShiftPoolSubscription | null = null;
    let rsvpSub: ShiftPoolSubscription | null = null;
    let attSub: ShiftPoolSubscription | null = null;
    let rsvpSeq = 0; // guards against an older in-flight RSVP sub landing late
    let attSeq = 0; // ditto for the attestation subscription
    let rsvpKey = ''; // address-set signature the current RSVP subscription covers
    let attKey = ''; // participant-set signature the attestation subscription covers
    let attParticipants = new Set<string>(); // and as a set, for the client-side re-filter
    let synced = false; // occurrence backlog drained (EOSE seen)
    let ready = false; // first full emission done — live events emit from here on
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const inRange = (o: ShiftOccurrence, r: ShiftScheduleRange) =>
      (r.since === undefined || o.end >= r.since) && (r.until === undefined || o.start <= r.until);

    function snapshot(): ShiftScheduleUpdate {
      const r = rangeOf();
      const occurrences = sortOccurrences([...occs.values()].filter((o) => inRange(o, r)));
      const visible = new Set(occurrences.map((o) => o.address));
      return {
        occurrences,
        rsvps: [...winners.values()].filter((rv) => visible.has(rv.address)),
        attestations: [...atts.values()],
      };
    }

    function emit(now = false) {
      if (closed) return;
      if (timer) clearTimeout(timer);
      if (now) {
        timer = null;
        opts.onSchedule(snapshot());
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        opts.onSchedule(snapshot());
      }, debounceMs);
    }

    async function open(filter: NostrFilterLike, params: ShiftPoolSubscribeParams): Promise<ShiftPoolSubscription> {
      const p = await pool();
      if (!p.subscribe) throw new Error('subscribeSchedule: the pool does not support live subscriptions');
      return p.subscribe(relays, filter, { ...params, maxWait });
    }

    /**
     * (Re)aim the RSVP subscription at the current occurrence addresses.
     * Only the past side is trimmed — the future side stays open so an
     * occurrence sliding into a moving range needs no re-subscription
     * (occurrences are only published days ahead, the set stays small).
     */
    function syncRsvpSub(onSynced?: () => void) {
      const { since } = rangeOf();
      const addrs = [...occs.values()]
        .filter((o) => since === undefined || o.end >= since)
        .map((o) => o.address)
        .sort();
      const key = addrs.join('\n');
      if (key === rsvpKey) {
        onSynced?.();
        return;
      }
      rsvpKey = key;
      const my = ++rsvpSeq;
      rsvpSub?.close();
      rsvpSub = null;
      if (!addrs.length) {
        onSynced?.();
        return;
      }
      open(rsvpFilter(addrs), {
        onevent(ev) {
          const r = parseShiftRsvp(ev);
          if (!r) return;
          const k = `${r.pubkey}\0${r.address}`;
          if (!rsvpSupersedes(r, winners.get(k))) return;
          winners.set(k, r);
          // A signer we have not seen yet may carry attestations — re-aim.
          // During the initial backlog the single sync in the EOSE chain
          // covers everyone at once.
          if (ready) {
            syncAttSub();
            emit();
          }
        },
        oneose() {
          if (my === rsvpSeq) onSynced?.();
        },
      }).then(
        (s) => {
          if (closed || my !== rsvpSeq) s.close();
          else rsvpSub = s;
        },
        (err) => opts.onError?.(err),
      );
    }

    /**
     * (Re)aim the attestation subscription at every RSVP author seen so
     * far, so names and the person-identity collapse ride the same live
     * feed as the schedule itself.
     */
    function syncAttSub(onSynced?: () => void) {
      const participants = [...new Set([...winners.values()].map((r) => r.pubkey.toLowerCase()))].sort();
      const key = participants.join('\n');
      if (key === attKey) {
        onSynced?.();
        return;
      }
      attKey = key;
      attParticipants = new Set(participants);
      const my = ++attSeq;
      attSub?.close();
      attSub = null;
      if (!participants.length) {
        onSynced?.();
        return;
      }
      open(attestationFilter({ participants }), {
        onevent(ev) {
          const a = parseIdentityAttestation(ev);
          // Re-apply the filter client-side — a relay that ignores `#p`
          // must degrade to extra bytes, never to foreign entries.
          if (!a || !a.pubkeys.some((pk) => attParticipants.has(pk))) return;
          const k = `${a.provider}\0${a.identifier}`;
          const prev = atts.get(k);
          if (prev && (prev.createdAt > a.createdAt || (prev.createdAt === a.createdAt && prev.id <= a.id))) return;
          atts.set(k, a);
          if (ready) emit();
        },
        oneose() {
          if (my === attSeq) onSynced?.();
        },
      }).then(
        (s) => {
          if (closed || my !== attSeq) s.close();
          else attSub = s;
        },
        (err) => opts.onError?.(err),
      );
    }

    open(occurrenceFilter({ groupId, coordinatorPubkey: options.coordinatorPubkey }), {
      onevent(ev) {
        const occ = parseShiftOccurrence(ev);
        if (!occ || occ.groupId !== groupId) return;
        const prev = occs.get(occ.address);
        if (prev && prev.createdAt >= occ.createdAt) return;
        occs.set(occ.address, occ);
        if (!synced) return; // the initial flood resolves in one go at EOSE
        syncRsvpSub();
        if (ready) emit();
      },
      oneose() {
        if (synced) return;
        synced = true;
        // Hold the first emission until the RSVP and attestation backlogs
        // have drained too: without the identity collapse a person who
        // cancelled under a sibling key would flash as enrolled.
        syncRsvpSub(() =>
          syncAttSub(() => {
            ready = true;
            emit(true);
          }),
        );
      },
    }).then(
      (s) => {
        if (closed) s.close();
        else occSub = s;
      },
      (err) => opts.onError?.(err),
    );

    return {
      close() {
        closed = true;
        rsvpSeq++;
        attSeq++;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        occSub?.close();
        occSub = null;
        rsvpSub?.close();
        rsvpSub = null;
        attSub?.close();
        attSub = null;
      },
    };
  }

  return {
    relays,
    fetchOccurrences,
    fetchRsvps,
    async fetchSchedule(groupId, range) {
      const occurrences = await fetchOccurrences(groupId, range);
      const rsvps = await fetchRsvps(occurrences);
      return { occurrences, rsvps };
    },
    subscribeSchedule,
    async fetchParticipantRsvps(pubkey) {
      const events = await query(participantRsvpFilter(pubkey));
      const parsed = events.map(parseShiftRsvp).filter((r): r is ShiftRsvp => r !== null);
      return [...resolveRsvps(parsed).values()];
    },
    fetchAttestations,
    async publishRsvp({ signer, previous, identity, ...build }) {
      let prev = previous;
      if (!prev) {
        const others = await fetchRsvps([build.occurrence as ShiftOccurrence]);
        let ident = identity;
        if (!ident) {
          // Best-effort: link the signer to their attested sibling keys so
          // the person-level previous is found — a cancel must out-timestamp
          // a signup made under the person's OTHER key (e.g. via Elinor).
          try {
            const atts = await fetchAttestations({ participants: [signer.pubkey.toLowerCase()] });
            ident = attestationIdentityMap(atts, { coordinatorPubkey: options.coordinatorPubkey });
          } catch {
            ident = undefined;
          }
        }
        prev = latestRsvpFor(build.occurrence, signer.pubkey, others, ident);
      }
      const event = signer.sign(buildRsvpTemplate({ ...build, previous: prev }));
      const p = await pool();
      // nostr-tools FULFILLS a publish whose connection failed, with a
      // "connection failure: …" string the relay never saw — normalize those
      // to rejections so callers' accepted-relay counts stay honest.
      const results = (await Promise.allSettled(p.publish(relays, event))).map(
        (r): PromiseSettledResult<string> =>
          r.status === 'fulfilled' && typeof r.value === 'string' && r.value.startsWith('connection failure:')
            ? { status: 'rejected', reason: r.value }
            : r,
      );
      return { event, results };
    },
    close() {
      if (poolPromise) void poolPromise.then((p) => p.close?.(relays));
    },
  };
}
