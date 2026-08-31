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
  sortOccurrences,
  type BuildRsvpOptions,
  type NostrFilterLike,
} from './protocol.js';
import type { ShiftOccurrence, ShiftRsvp } from './types.js';

/** The subset of nostr-tools' `SimplePool` we rely on (injectable for tests). */
export interface ShiftPoolLike {
  querySync(relays: string[], filter: NostrFilterLike, params?: { maxWait?: number }): Promise<Event[]>;
  publish(relays: string[], event: Event): Promise<string>[];
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

export interface ShiftRelayClient {
  readonly relays: string[];
  /** Occurrences for a group in `[since, until]` (unix seconds, by shift start). */
  fetchOccurrences(groupId: string, range?: { since?: number; until?: number }): Promise<ShiftOccurrence[]>;
  /** Resolved RSVPs for the given occurrences. */
  fetchRsvps(occurrences: ShiftOccurrence[]): Promise<ShiftRsvp[]>;
  /** Occurrences + resolved RSVPs in one call. */
  fetchSchedule(groupId: string, range?: { since?: number; until?: number }): Promise<ShiftSchedule>;
  /** One participant's resolved RSVPs. */
  fetchParticipantRsvps(pubkey: string): Promise<ShiftRsvp[]>;
  /**
   * Sign and publish a signup/cancellation as `signer` (the participant).
   * Looks up the participant's previous RSVP so `created_at` strictly
   * increases. Resolves with the signed event and per-relay outcomes.
   */
  publishRsvp(
    opts: Omit<BuildRsvpOptions, 'previous'> & { signer: NostrSigner; previous?: ShiftRsvp },
  ): Promise<{ event: Event; results: PromiseSettledResult<string>[] }>;
  close(): void;
}

async function defaultPool(): Promise<ShiftPoolLike> {
  const { SimplePool } = await import('nostr-tools/pool');
  return new SimplePool() as unknown as ShiftPoolLike;
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

  return {
    relays,
    fetchOccurrences,
    fetchRsvps,
    async fetchSchedule(groupId, range) {
      const occurrences = await fetchOccurrences(groupId, range);
      const rsvps = await fetchRsvps(occurrences);
      return { occurrences, rsvps };
    },
    async fetchParticipantRsvps(pubkey) {
      const events = await query(participantRsvpFilter(pubkey));
      const parsed = events.map(parseShiftRsvp).filter((r): r is ShiftRsvp => r !== null);
      return [...resolveRsvps(parsed).values()];
    },
    async publishRsvp({ signer, previous, ...build }) {
      let prev = previous;
      if (!prev) {
        const mine = await fetchRsvps([build.occurrence as ShiftOccurrence]);
        prev = latestRsvpFor(build.occurrence, signer.pubkey, mine);
      }
      const event = signer.sign(buildRsvpTemplate({ ...build, previous: prev }));
      const p = await pool();
      const results = await Promise.allSettled(p.publish(relays, event));
      return { event, results };
    },
    close() {
      if (poolPromise) void poolPromise.then((p) => p.close?.(relays));
    },
  };
}
