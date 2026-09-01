import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils';
import { signerFromSecretKey } from '../holosphere/signers.js';
import {
  SHIFT_OCCURRENCE_KIND,
  SHIFT_RSVP_KIND,
  attestationIdentityMap,
  attestationNameMap,
  buildRsvpTemplate,
  createShiftRelayClient,
  enrolledPubkeys,
  hasCapacity,
  isEnrolled,
  latestRsvpFor,
  occurrenceFilter,
  parseShiftAddress,
  parseShiftDTag,
  parseShiftOccurrence,
  parseShiftRsvp,
  participantRsvpFilter,
  resolveRsvps,
  rsvpDTag,
  rsvpFilter,
  shiftAddress,
  shiftDTag,
  type IdentityAttestation,
  type NostrEventLike,
  type ShiftOccurrence,
  type ShiftPoolLike,
  type ShiftRsvp,
} from './index.js';

const COORD = '3f432836bece7b0a06dcbaef023f113fdcb10f96fbf98f35dd2e3b3a3c0e2dcb';
const GROUP = '-5459621960';

// Verbatim shape of a live event on relay.commonshub.dev (2026-08-30).
const occurrenceEvent: NostrEventLike = {
  content: 'Dinner Preparation shift, 16:30–18:30 (Valley of the Commons)',
  created_at: 1788078250,
  id: '4f6ae8a12d19ff402488931a3c8cc6dceffdd4e001cee32fb0764c4d6543ca0e',
  kind: 31923,
  pubkey: COORD,
  tags: [
    ['d', 'shift--5459621960-2026-08-30-dp'],
    ['title', 'Dinner Preparation'],
    ['start', '1788100200'],
    ['end', '1788107400'],
    ['start_tzid', 'Europe/Brussels'],
    ['location', 'Valley of the Commons'],
    ['capacity', '2'],
    ['t', 'shift'],
    ['t', 'dp'],
    ['t', 'group--5459621960'],
  ],
};

function rsvpEvent(pubkey: string, status: string, created_at: number, id: string, changedBy?: string): NostrEventLike {
  const tags = [
    ['a', shiftAddress(COORD, 'shift--5459621960-2026-08-30-dp')],
    ['d', 'rsvp--5459621960-2026-08-30-dp'],
    ['status', status],
    ['t', 'shift'],
  ];
  if (changedBy) tags.push(['p', changedBy, '', 'changed-by']);
  return { kind: 31925, pubkey, created_at, id, tags, content: '' };
}

describe('d-tags and addresses', () => {
  it('round-trips negative Telegram chat ids', () => {
    const key = { groupId: GROUP, date: '2026-08-30', code: 'dp' };
    expect(shiftDTag(key)).toBe('shift--5459621960-2026-08-30-dp');
    expect(rsvpDTag(key)).toBe('rsvp--5459621960-2026-08-30-dp');
    expect(parseShiftDTag(shiftDTag(key))).toEqual({ kind: 'shift', ...key });
    expect(parseShiftDTag(rsvpDTag(key))).toEqual({ kind: 'rsvp', ...key });
  });

  it('rejects malformed d-tags', () => {
    expect(parseShiftDTag('shift-abc')).toBeNull();
    expect(parseShiftDTag('shift--1-2026-8-30-dp')).toBeNull();
    expect(parseShiftDTag('shift--1-2026-08-30-TOOLONGCODE12345678')).toBeNull();
  });

  it('builds and parses the a-tag address', () => {
    const a = shiftAddress(COORD, 'shift--5459621960-2026-08-30-dp');
    expect(a).toBe(`31923:${COORD}:shift--5459621960-2026-08-30-dp`);
    expect(parseShiftAddress(a)).toEqual({ kind: 31923, pubkey: COORD, dTag: 'shift--5459621960-2026-08-30-dp' });
    expect(parseShiftAddress('nope')).toBeNull();
  });
});

describe('parseShiftOccurrence', () => {
  it('parses a live coordinator event', () => {
    const occ = parseShiftOccurrence(occurrenceEvent)!;
    expect(occ).toMatchObject({
      groupId: GROUP,
      date: '2026-08-30',
      code: 'dp',
      title: 'Dinner Preparation',
      start: 1788100200,
      end: 1788107400,
      startTzid: 'Europe/Brussels',
      location: 'Valley of the Commons',
      capacity: 2,
      pubkey: COORD,
    });
    expect(occ.address).toBe(`31923:${COORD}:shift--5459621960-2026-08-30-dp`);
  });

  it('returns null for other kinds or missing times', () => {
    expect(parseShiftOccurrence({ ...occurrenceEvent, kind: 1 })).toBeNull();
    expect(parseShiftOccurrence({ ...occurrenceEvent, tags: occurrenceEvent.tags.filter((t) => t[0] !== 'start') })).toBeNull();
  });

  it('treats a missing capacity as unlimited', () => {
    const occ = parseShiftOccurrence({ ...occurrenceEvent, tags: occurrenceEvent.tags.filter((t) => t[0] !== 'capacity') })!;
    expect(occ.capacity).toBeUndefined();
    expect(hasCapacity(occ, [])).toBe(true);
  });
});

describe('RSVP resolution', () => {
  const occ = parseShiftOccurrence(occurrenceEvent)!;
  const alice = 'a'.repeat(64);
  const bob = 'b'.repeat(64);
  const carol = 'c'.repeat(64);

  const parse = (e: NostrEventLike) => parseShiftRsvp(e)!;

  it('parses status and changed-by', () => {
    const r = parse(rsvpEvent(alice, 'accepted', 10, '01', bob));
    expect(r.status).toBe('accepted');
    expect(r.changedBy).toBe(bob);
    expect(parseShiftRsvp(rsvpEvent(alice, 'maybe', 10, '01'))).toBeNull();
  });

  it('newest created_at wins, regardless of input order', () => {
    const rsvps = [
      parse(rsvpEvent(alice, 'declined', 20, '02')),
      parse(rsvpEvent(alice, 'accepted', 10, '01')),
    ];
    expect(isEnrolled(occ, alice, rsvps)).toBe(false);
    expect(isEnrolled(occ, alice, rsvps.reverse())).toBe(false);
  });

  it('ties break to the lexically smallest id', () => {
    const rsvps = [parse(rsvpEvent(alice, 'declined', 10, 'ff')), parse(rsvpEvent(alice, 'accepted', 10, '0a'))];
    expect(isEnrolled(occ, alice, rsvps)).toBe(true);
    expect(resolveRsvps(rsvps).size).toBe(1);
  });

  it('counts enrolled participants against capacity', () => {
    const rsvps = [
      parse(rsvpEvent(alice, 'accepted', 10, '01')),
      parse(rsvpEvent(bob, 'accepted', 11, '02')),
      parse(rsvpEvent(carol, 'accepted', 12, '03')),
      parse(rsvpEvent(carol, 'declined', 13, '04')),
    ];
    expect(enrolledPubkeys(occ, rsvps)).toEqual([alice, bob]);
    expect(hasCapacity(occ, rsvps)).toBe(false);
    expect(hasCapacity(occ, rsvps.slice(0, 1))).toBe(true);
  });
});

describe('person-level resolution (identity collapse)', () => {
  const occ = parseShiftOccurrence(occurrenceEvent)!;
  // One person, two keys — the Elinor-side key and the Holons-derived one,
  // bridged by a kind-31926 attestation (docs/shifts-elinor.md).
  const elinorKey = 'e'.repeat(64);
  const holonsKey = 'f'.repeat(64);
  const stranger = '9'.repeat(64);
  const identity = new Map([
    [elinorKey, 'telegram:123'],
    [holonsKey, 'telegram:123'],
  ]);
  const parse = (e: NostrEventLike) => parseShiftRsvp(e)!;

  it('a cancel under one key supersedes a signup under a sibling key', () => {
    // The live bug: accepted on the kiosk (Holons key), then cancelled in
    // Elinor (Elinor key). Per-key resolution leaves the person enrolled.
    const rsvps = [
      parse(rsvpEvent(holonsKey, 'accepted', 100, '01')),
      parse(rsvpEvent(elinorKey, 'declined', 101, '02')),
    ];
    expect(isEnrolled(occ, holonsKey, rsvps)).toBe(true); // legacy per-key view
    expect(isEnrolled(occ, holonsKey, rsvps, identity)).toBe(false);
    expect(isEnrolled(occ, elinorKey, rsvps, identity)).toBe(false);
    expect(enrolledPubkeys(occ, rsvps, identity)).toEqual([]);
    // Asked under either key, the person's latest RSVP is the sibling cancel.
    expect(latestRsvpFor(occ, holonsKey, rsvps, identity)?.id).toBe('02');
  });

  it('resolves to one RSVP per person, newest across all keys, ties to smallest id', () => {
    const rsvps = [
      parse(rsvpEvent(holonsKey, 'accepted', 100, 'ff')),
      parse(rsvpEvent(elinorKey, 'declined', 100, '0a')),
    ];
    const winners = resolveRsvps(rsvps, identity);
    expect(winners.size).toBe(1);
    expect([...winners.values()][0].status).toBe('declined');
  });

  it('counts a two-keyed person once against capacity', () => {
    const rsvps = [
      parse(rsvpEvent(holonsKey, 'accepted', 100, '01')),
      parse(rsvpEvent(elinorKey, 'accepted', 101, '02')),
    ];
    expect(enrolledPubkeys(occ, rsvps, identity)).toHaveLength(1);
    expect(hasCapacity(occ, rsvps, identity)).toBe(true); // capacity 2, one person on
  });

  it('leaves unattested keys resolving per-key as before', () => {
    const rsvps = [
      parse(rsvpEvent(stranger, 'accepted', 100, '01')),
      parse(rsvpEvent(holonsKey, 'accepted', 101, '02')),
    ];
    expect(enrolledPubkeys(occ, rsvps, identity).sort()).toEqual([stranger, holonsKey].sort());
  });
});

describe('buildRsvpTemplate', () => {
  const occ = parseShiftOccurrence(occurrenceEvent)!;

  it('emits the Elinor tag set with empty content', () => {
    const t = buildRsvpTemplate({ occurrence: occ, status: 'accepted', now: 100 });
    expect(t.kind).toBe(SHIFT_RSVP_KIND);
    expect(t.content).toBe('');
    expect(t.created_at).toBe(100);
    expect(t.tags).toEqual([
      ['a', occ.address],
      ['d', 'rsvp--5459621960-2026-08-30-dp'],
      ['status', 'accepted'],
      ['t', 'shift'],
    ]);
  });

  it('adds changed-by when an actor signs for someone else', () => {
    const t = buildRsvpTemplate({ occurrence: occ, status: 'declined', actorPubkey: 'x'.repeat(64), now: 1 });
    expect(t.tags).toContainEqual(['p', 'x'.repeat(64), '', 'changed-by']);
  });

  it('bumps created_at strictly past the previous RSVP', () => {
    const t = buildRsvpTemplate({ occurrence: occ, status: 'declined', now: 100, previous: { createdAt: 500 } });
    expect(t.created_at).toBe(501);
  });

  it('produces a valid signed event', () => {
    const sk = generateSecretKey();
    const ev = finalizeEvent(buildRsvpTemplate({ occurrence: occ, status: 'accepted' }), sk);
    expect(verifyEvent(ev)).toBe(true);
    expect(parseShiftRsvp(ev)?.pubkey).toBe(getPublicKey(sk));
  });
});

describe('filters', () => {
  it('match the documented REQ shapes', () => {
    expect(occurrenceFilter({ groupId: GROUP, coordinatorPubkey: COORD })).toEqual({
      kinds: [SHIFT_OCCURRENCE_KIND],
      authors: [COORD],
      '#t': ['group--5459621960'],
    });
    expect(rsvpFilter(['a1'])).toEqual({ kinds: [31925], '#a': ['a1'] });
    expect(participantRsvpFilter('pk')).toEqual({ kinds: [31925], authors: ['pk'], '#t': ['shift'] });
  });
});

function eventMatches(filter: Record<string, unknown>, e: NostrEventLike): boolean {
  const f = filter as { kinds?: number[]; authors?: string[] };
  if (f.kinds && !f.kinds.includes(e.kind)) return false;
  if (f.authors && !f.authors.includes(e.pubkey)) return false;
  for (const [k, vals] of Object.entries(filter)) {
    if (!k.startsWith('#') || !vals) continue;
    const name = k.slice(1);
    if (!e.tags.some((t) => t[0] === name && (vals as string[]).includes(t[1]))) return false;
  }
  return true;
}

describe('createShiftRelayClient', () => {
  function fakePool(store: NostrEventLike[]): ShiftPoolLike & { published: NostrEventLike[] } {
    const published: NostrEventLike[] = [];
    return {
      published,
      async querySync(_relays, filter) {
        return store.filter((e) => eventMatches(filter, e)) as never;
      },
      publish(_relays, event) {
        published.push(event);
        store.push(event);
        return [Promise.resolve('ok')];
      },
    };
  }

  it('fetches, resolves and signs against an injected pool', async () => {
    const sk = generateSecretKey();
    const me = getPublicKey(sk);
    const store: NostrEventLike[] = [
      occurrenceEvent,
      // stale republish of the same occurrence — newer created_at must win
      { ...occurrenceEvent, created_at: occurrenceEvent.created_at - 1000, id: 'old', tags: occurrenceEvent.tags.map((t) => (t[0] === 'capacity' ? ['capacity', '9'] : t)) },
      rsvpEvent(me, 'accepted', 1000, '01'),
    ];
    const pool = fakePool(store);
    const client = createShiftRelayClient({ relays: ['wss://example'], coordinatorPubkey: COORD, pool });

    const { occurrences, rsvps } = await client.fetchSchedule(GROUP);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].capacity).toBe(2);
    expect(rsvps.map((r: ShiftRsvp) => r.pubkey)).toEqual([me]);
    expect(isEnrolled(occurrences[0], me, rsvps)).toBe(true);

    const { event, results } = await client.publishRsvp({
      occurrence: occurrences[0],
      status: 'declined',
      signer: signerFromSecretKey(bytesToHex(sk)),
    });
    expect(results[0].status).toBe('fulfilled');
    expect(verifyEvent(event)).toBe(true);
    expect(event.created_at).toBeGreaterThan(1000);
    expect(pool.published).toHaveLength(1);

    const after = await client.fetchRsvps(occurrences);
    expect(isEnrolled(occurrences[0], me, after)).toBe(false);
  });

  it('bumps created_at past a sibling-key RSVP found via attestations', async () => {
    const sk = generateSecretKey();
    const me = getPublicKey(sk);
    const sibling = '5'.repeat(64);
    // The sibling key's signup carries a created_at ahead of the wall clock;
    // without the identity collapse the cancel below would lose to it.
    const ahead = Math.floor(Date.now() / 1000) + 900;
    const store: NostrEventLike[] = [
      occurrenceEvent,
      rsvpEvent(sibling, 'accepted', ahead, '01'),
      {
        kind: 31926,
        pubkey: COORD,
        created_at: 1,
        id: 'att',
        content: '{"name":"Same person"}',
        tags: [['d', 'telegram:123'], ['p', me], ['p', sibling]],
      },
    ];
    const client = createShiftRelayClient({ relays: ['wss://example'], coordinatorPubkey: COORD, pool: fakePool(store) });
    const [occ] = await client.fetchOccurrences(GROUP);
    const { event } = await client.publishRsvp({ occurrence: occ, status: 'declined', signer: signerFromSecretKey(bytesToHex(sk)) });
    expect(event.created_at).toBe(ahead + 1);
    const after = await client.fetchRsvps([occ]);
    const identity = new Map([[me, 'telegram:123'], [sibling, 'telegram:123']]);
    expect(isEnrolled(occ, sibling, after, identity)).toBe(false);
  });

  it('filters occurrences by start range and untrusted authors', async () => {
    const store: NostrEventLike[] = [occurrenceEvent, { ...occurrenceEvent, pubkey: 'e'.repeat(64), id: 'imposter' }];
    const client = createShiftRelayClient({ relays: ['wss://example'], coordinatorPubkey: COORD, pool: fakePool(store) });
    expect(await client.fetchOccurrences(GROUP)).toHaveLength(1);
    expect(await client.fetchOccurrences(GROUP, { since: 1788107401 })).toHaveLength(0);
    expect(await client.fetchOccurrences(GROUP, { until: 1788100199 })).toHaveLength(0);
    expect(await client.fetchOccurrences(GROUP, { since: 1788100000, until: 1788200000 })).toHaveLength(1);
  });

  it('requires a relay', () => {
    expect(() => createShiftRelayClient({ relays: [] })).toThrow();
  });
});

describe('subscribeSchedule', () => {
  /** A pool with live REQ semantics: backlog + EOSE, then pushed events. */
  function livePool(store: NostrEventLike[]) {
    const subs: { filter: Record<string, unknown>; onevent?: (e: never) => void; oneose?: () => void; closed: boolean }[] = [];
    return {
      subs,
      async querySync(_relays: string[], filter: Record<string, unknown>) {
        return store.filter((e) => eventMatches(filter, e)) as never[];
      },
      publish(_relays: string[], event: NostrEventLike) {
        store.push(event);
        return [Promise.resolve('ok')];
      },
      subscribe(_relays: string[], filter: Record<string, unknown>, params: { onevent?: (e: never) => void; oneose?: () => void }) {
        const sub = { filter, onevent: params.onevent, oneose: params.oneose, closed: false };
        subs.push(sub);
        queueMicrotask(() => {
          if (sub.closed) return;
          for (const e of store) if (eventMatches(filter, e)) sub.onevent?.(e as never);
          sub.oneose?.();
        });
        return {
          close() {
            sub.closed = true;
          },
        };
      },
      push(event: NostrEventLike) {
        store.push(event);
        for (const s of subs) {
          if (!s.closed && eventMatches(s.filter, event)) s.onevent?.(event as never);
        }
      },
    };
  }

  const tick = () => new Promise((r) => setTimeout(r, 10));

  function subscribe(pool: ReturnType<typeof livePool>, range?: { since?: number; until?: number }) {
    const emitted: { occurrences: { address: string }[]; rsvps: ShiftRsvp[] }[] = [];
    const client = createShiftRelayClient({
      relays: ['wss://example'],
      coordinatorPubkey: COORD,
      pool: pool as unknown as ShiftPoolLike,
    });
    const sub = client.subscribeSchedule(GROUP, {
      range,
      debounceMs: 0,
      onSchedule: (s) => emitted.push(s),
    });
    return { emitted, sub, last: () => emitted[emitted.length - 1] };
  }

  it('emits the backlog once, then pushes live RSVP and occurrence changes', async () => {
    const me = 'a'.repeat(64);
    const pool = livePool([occurrenceEvent, rsvpEvent(me, 'accepted', 1000, '01')]);
    const { emitted, sub, last } = subscribe(pool);

    await tick();
    // One emission for the whole backlog: occurrence + its resolved RSVP.
    expect(emitted).toHaveLength(1);
    expect(last().occurrences).toHaveLength(1);
    expect(isEnrolled(last().occurrences[0], me, last().rsvps)).toBe(true);

    // An external cancel (e.g. from Elinor) lands without any re-fetch.
    pool.push(rsvpEvent(me, 'declined', 2000, '02'));
    await tick();
    expect(isEnrolled(last().occurrences[0], me, last().rsvps)).toBe(false);

    // A newly published occurrence appears, and its RSVPs are picked up
    // by the re-aimed RSVP subscription.
    const other = {
      ...occurrenceEvent,
      id: 'occ2',
      tags: occurrenceEvent.tags.map((t) => (t[0] === 'd' ? ['d', 'shift--5459621960-2026-08-31-mc'] : t)),
    };
    pool.push(other);
    await tick();
    expect(last().occurrences).toHaveLength(2);
    const addr2 = shiftAddress(COORD, 'shift--5459621960-2026-08-31-mc');
    pool.push({ ...rsvpEvent(me, 'accepted', 3000, '03'), tags: [['a', addr2], ['d', 'rsvp--5459621960-2026-08-31-mc'], ['status', 'accepted'], ['t', 'shift']] });
    await tick();
    expect(last().rsvps.some((r) => r.address === addr2 && r.status === 'accepted')).toBe(true);
    sub.close();
  });

  it('applies the range window and ignores stale occurrence republishes', async () => {
    const pool = livePool([occurrenceEvent]);
    // occurrenceEvent runs 1788100200–1788107400; window it out entirely.
    const { sub, last, emitted } = subscribe(pool, { since: 1788107401 });
    await tick();
    expect(emitted).toHaveLength(1);
    expect(last().occurrences).toHaveLength(0);
    // A stale republish (older created_at) must not resurrect anything.
    pool.push({ ...occurrenceEvent, created_at: occurrenceEvent.created_at - 1, id: 'stale' });
    await tick();
    expect(emitted).toHaveLength(1);
    sub.close();
  });

  it('feeds attestations through the same subscription (names + person collapse)', async () => {
    const me = 'a'.repeat(64);
    const sibling = 'b'.repeat(64);
    const attestation = (created_at: number, name: string, id: string): NostrEventLike => ({
      kind: 31926,
      pubkey: COORD,
      created_at,
      id,
      content: JSON.stringify({ name }),
      tags: [['d', 'telegram:123'], ['p', me], ['p', sibling]],
    });
    const pool = livePool([occurrenceEvent, rsvpEvent(sibling, 'accepted', 1000, '01'), attestation(1, 'Roberto', 'att1')]);
    const { emitted, sub, last } = subscribe(pool);

    await tick();
    // One emission carries schedule AND attestations — no separate pull.
    expect(emitted).toHaveLength(1);
    const first = last() as { attestations: IdentityAttestation[]; occurrences: ShiftOccurrence[]; rsvps: ShiftRsvp[] };
    expect(first.attestations).toHaveLength(1);
    const identity = attestationIdentityMap(first.attestations, { coordinatorPubkey: COORD });
    expect(identity.get(sibling)).toBe('telegram:123');
    expect(attestationNameMap(first.attestations, { coordinatorPubkey: COORD }).get(me)).toBe('Roberto');
    expect(isEnrolled(first.occurrences[0], sibling, first.rsvps, identity)).toBe(true);

    // A cancel under the person's OTHER key clears them via the collapse.
    pool.push(rsvpEvent(me, 'declined', 2000, '02'));
    await tick();
    const next = last() as { attestations: IdentityAttestation[]; occurrences: ShiftOccurrence[]; rsvps: ShiftRsvp[] };
    const id2 = attestationIdentityMap(next.attestations, { coordinatorPubkey: COORD });
    expect(isEnrolled(next.occurrences[0], sibling, next.rsvps, id2)).toBe(false);

    // A re-published attestation (rename) lands live too.
    pool.push(attestation(2, 'Rob', 'att2'));
    await tick();
    const renamed = last() as { attestations: IdentityAttestation[] };
    expect(attestationNameMap(renamed.attestations, { coordinatorPubkey: COORD }).get(me)).toBe('Rob');
    sub.close();
  });

  it('re-aims the attestation subscription when a new signer appears', async () => {
    const me = 'a'.repeat(64);
    const stranger = 'c'.repeat(64);
    const pool = livePool([
      occurrenceEvent,
      rsvpEvent(me, 'accepted', 1000, '01'),
      // Already stored on the relay, but for a pubkey with no RSVP yet —
      // the initial attestation sub does not cover it.
      {
        kind: 31926,
        pubkey: COORD,
        created_at: 1,
        id: 'att-stranger',
        content: '{"name":"Stranger"}',
        tags: [['d', 'telegram:456'], ['p', stranger]],
      } satisfies NostrEventLike,
    ]);
    const { sub, last } = subscribe(pool);
    await tick();
    expect((last() as { attestations: IdentityAttestation[] }).attestations).toHaveLength(0);

    // Their signup arrives → the sub re-aims → their attestation is found.
    pool.push({ ...rsvpEvent(stranger, 'accepted', 2000, '02'), id: '02' });
    await tick();
    const attsSeen = (last() as { attestations: IdentityAttestation[] }).attestations;
    expect(attsSeen.map((a) => a.identifier)).toEqual(['telegram:456']);
    sub.close();
  });

  it('stops emitting after close()', async () => {
    const me = 'a'.repeat(64);
    const pool = livePool([occurrenceEvent]);
    const { emitted, sub } = subscribe(pool);
    await tick();
    expect(emitted).toHaveLength(1);
    sub.close();
    pool.push(rsvpEvent(me, 'accepted', 1000, '01'));
    await tick();
    expect(emitted).toHaveLength(1);
    expect(pool.subs.every((s) => s.closed)).toBe(true);
  });

  it('reports a pool without live subscriptions through onError', async () => {
    const client = createShiftRelayClient({
      relays: ['wss://example'],
      coordinatorPubkey: COORD,
      pool: { async querySync() { return []; }, publish: () => [Promise.resolve('ok')] } as unknown as ShiftPoolLike,
    });
    const errors: unknown[] = [];
    client.subscribeSchedule(GROUP, { onSchedule: () => {}, onError: (e) => errors.push(e) });
    await tick();
    expect(errors).toHaveLength(1);
  });
});
