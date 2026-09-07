// The `shifts` lens carried on its standard kinds. Fixtures are real events
// pulled from relay.commonshub.dev, not hand-written approximations, so the
// grammars they exercise are the ones Elinor actually publishes.
import { describe, expect, it } from 'vitest';
import { attestationNameMap, attestationIdentityMap } from './attestation.js';
import {
  SHIFTS_LENS,
  SHIFT_IDENTITY_LENS,
  SHIFT_RSVP_LENS,
  attestationsFrom,
  createShiftIdentityWire,
  decodeAttestation,
  authorizeShiftEvent,
  createShiftWire,
  decodeShiftEvent,
  participantsOf,
  shiftFilters,
  type ShiftRsvpRecord,
} from './wire.js';

const COORD = '3f432836bece7b0a06dcbaef023f113fdcb10f96fbf98f35dd2e3b3a3c0e2dcb';
const HOLON = '-1003691108237';

const OCCURRENCE = {
  id: '3bb28d030f8f55ac9afb95543e8dd0da701f090b699b2b170348a1ad0bf29067',
  pubkey: COORD,
  kind: 31923,
  created_at: 1788732015,
  content: 'Dinner Cleaning shift, 20:30–22:30 (Valley of the Commons)',
  tags: [
    ['d', 'shift--1003691108237-2026-09-20-dc'],
    ['title', 'Dinner Cleaning'],
    ['start', '1789929000'],
    ['end', '1789936200'],
    ['start_tzid', 'Europe/Brussels'],
    ['location', 'Valley of the Commons'],
    ['capacity', '2'],
    ['t', 'shift'], ['t', 'dc'], ['t', 'group--1003691108237'],
  ],
};

const RSVP = {
  id: '66aaefb10cfa6f9095ff418a7cea846e63172b87094e2687a41bb82d3500b597',
  pubkey: '8f7c6e31973b5cd9c37311023290252e1d20428e264a5d1207d208cb0a51106b',
  kind: 31925,
  created_at: 1788714968,
  content: '',
  tags: [
    ['a', `31923:${COORD}:shift--1003691108237-2026-09-07-dp`],
    ['d', 'rsvp--1003691108237-2026-09-07-dp'],
    ['status', 'accepted'],
    ['t', 'shift'],
  ],
};

// An agent's request published for someone else. Note the d tag carries the
// subject's key prefix, a grammar the shift d-tag rule does not admit.
const ON_BEHALF_OF = {
  id: 'd4dd295adc62a2241b01f8cedb6ff17da5d2f22a846a53f06bf1451b1244ecd5',
  pubkey: 'a41f5cfb14b4a1dc2059dbfda5b3b6d93e7be78e618449df717e71176055608b',
  kind: 31925,
  created_at: 1788259724,
  content: '',
  tags: [
    ['a', `31923:${COORD}:shift--5527409240-2026-09-03-dc`],
    ['d', 'rsvp--5527409240-2026-09-03-dc-68cf1d17'],
    ['p', '68cf1d179718f2f9eef59cff2af51047266ec4ae77e5e9ae9a6d9850191f6825', '', 'on-behalf-of'],
    ['status', 'declined'],
    ['t', 'shift'],
  ],
};

describe('shift wire: decoding', () => {
  it('lands an occurrence on the shifts lens at date-code', () => {
    const [claim] = decodeShiftEvent(OCCURRENCE)!;
    expect(claim.holon).toBe(HOLON);
    expect(claim.lens).toBe(SHIFTS_LENS);
    expect(claim.id).toBe('2026-09-20-dc');
    expect(claim.item).toMatchObject({
      code: 'dc',
      date: '2026-09-20',
      title: 'Dinner Cleaning',
      start: 1789929000,
      end: 1789936200,
      startTzid: 'Europe/Brussels',
      location: 'Valley of the Commons',
      capacity: 2,
      coordinator: COORD,
    });
  });

  it('lands a signup on its own lens, one record per person per occurrence', () => {
    const [claim] = decodeShiftEvent(RSVP)!;
    expect(claim.holon).toBe(HOLON);
    expect(claim.lens).toBe(SHIFT_RSVP_LENS);
    expect(claim.id).toBe(`2026-09-07-dp|${RSVP.pubkey}`);
    expect(claim.item).toMatchObject({ occurrence: '2026-09-07-dp', status: 'accepted', createdAt: 1788714968 });
    expect(claim.item.request).toBeUndefined();
  });

  it('reads the occurrence from the `a` address, not the signup\'s own d tag', () => {
    // This real event's d tag is `rsvp-<group>-<date>-<code>-<keyprefix>`,
    // which the shift d-tag grammar rejects. The address still resolves it.
    const [claim] = decodeShiftEvent(ON_BEHALF_OF)!;
    expect(claim.holon).toBe('-5527409240');
    expect(claim.item.occurrence).toBe('2026-09-03-dc');
  });

  it('marks an on-behalf-of signup as a request, not occupancy', () => {
    const [claim] = decodeShiftEvent(ON_BEHALF_OF)!;
    expect(claim.item.request).toBe(true);
  });

  it('ignores a kind it does not carry', () => {
    expect(decodeShiftEvent({ ...OCCURRENCE, kind: 30402 })).toBeNull();
  });

  it('returns null rather than throwing on a malformed event', () => {
    expect(decodeShiftEvent({ ...OCCURRENCE, tags: [] })).toBeNull();
    expect(decodeShiftEvent({ ...RSVP, tags: [['status', 'accepted']] })).toBeNull();
  });
});

describe('shift wire: authorization', () => {
  it('accepts only the coordinator\'s occurrences when one is pinned', () => {
    expect(authorizeShiftEvent(OCCURRENCE, { coordinatorPubkey: COORD })).toBe(true);
    expect(authorizeShiftEvent({ ...OCCURRENCE, pubkey: 'ff'.repeat(32) }, { coordinatorPubkey: COORD })).toBe(false);
  });

  it('accepts any author when no coordinator is pinned', () => {
    expect(authorizeShiftEvent({ ...OCCURRENCE, pubkey: 'ff'.repeat(32) })).toBe(true);
  });

  it('accepts a signup from anyone — the signer is always its own subject', () => {
    expect(authorizeShiftEvent(RSVP, { coordinatorPubkey: COORD })).toBe(true);
  });

  it('the wire refuses to decode what it would not authorize', () => {
    const wire = createShiftWire({ coordinatorPubkey: COORD });
    expect(wire.decode(OCCURRENCE)).not.toBeNull();
    expect(wire.decode({ ...OCCURRENCE, pubkey: 'ff'.repeat(32) })).toBeNull();
  });
});

describe('shift wire: filters', () => {
  it('subscribes to the group\'s occurrences and to signups by hashtag', () => {
    const [occ, rsvp] = shiftFilters(HOLON, COORD);
    expect(occ).toEqual({ kinds: [31923], '#t': ['group--1003691108237'], authors: [COORD] });
    expect(rsvp).toEqual({ kinds: [31925], '#t': ['shift'] });
  });

  it('drops the author narrowing when no coordinator is pinned', () => {
    expect(shiftFilters(HOLON)[0].authors).toBeUndefined();
  });
});

describe('shift wire: who is holding a shift', () => {
  const at = (pubkey: string, status: 'accepted' | 'declined', createdAt: number, extra = {}): ShiftRsvpRecord => ({
    id: `2026-09-07-dp|${pubkey}`, occurrence: '2026-09-07-dp', pubkey, status, createdAt,
    address: `31923:${COORD}:shift--1003691108237-2026-09-07-dp`, ...extra,
  });

  it('counts the accepted', () => {
    expect(participantsOf('2026-09-07-dp', [at('a', 'accepted', 10), at('b', 'declined', 10)])).toEqual(['a']);
  });

  it('takes the newest signup per person', () => {
    expect(participantsOf('2026-09-07-dp', [at('a', 'accepted', 10), at('a', 'declined', 20)])).toEqual([]);
    expect(participantsOf('2026-09-07-dp', [at('a', 'declined', 20), at('a', 'accepted', 30)])).toEqual(['a']);
  });

  it('never counts a request', () => {
    expect(participantsOf('2026-09-07-dp', [at('a', 'accepted', 10, { request: true })])).toEqual([]);
  });

  it('ignores signups for another occurrence', () => {
    const other = { ...at('a', 'accepted', 10), occurrence: '2026-09-08-dp' };
    expect(participantsOf('2026-09-07-dp', [other])).toEqual([]);
  });

  it('collapses a person\'s several keys, so a cancel under one beats a signup under another', () => {
    const identity = new Map([['key1', 'person'], ['key2', 'person']]);
    expect(participantsOf('2026-09-07-dp', [at('key1', 'accepted', 10), at('key2', 'declined', 20)], identity)).toEqual([]);
    // One entry for the person, identified by the key that actually signed the
    // winning event — which is what a name map is keyed by.
    expect(participantsOf('2026-09-07-dp', [at('key1', 'declined', 10), at('key2', 'accepted', 20)], identity)).toEqual(['key2']);
  });
});

// A real attestation, pulled off relay.commonshub.dev.
const ATTESTATION = {
  id: '4143d30d293531d99a35c885b644b154ae947f25ea741f1f05debee84ea01350',
  pubkey: COORD,
  kind: 31926,
  created_at: 1788714735,
  content: '{"name":"Samuel"}',
  tags: [
    ['d', 'telegram:1117779550'],
    ['p', '01c2adb79d1c55df26081710e4845836758921835362a5d889c68a3671b115a5'],
  ],
};

describe('identity wire: the attestation directory', () => {
  it('lands on a global lens, one record per provider claim', () => {
    const [claim] = decodeAttestation(ATTESTATION)!;
    expect(claim.holon).toBeNull();
    expect(claim.lens).toBe(SHIFT_IDENTITY_LENS);
    expect(claim.id).toBe(`${COORD}|telegram:1117779550`);
    expect(claim.item).toMatchObject({
      provider: COORD,
      identifier: 'telegram:1117779550',
      platform: 'telegram',
      platformId: '1117779550',
      name: 'Samuel',
      eventId: ATTESTATION.id,
    });
  });

  it('keeps the event id separate, because `id` has to be the address', () => {
    const [claim] = decodeAttestation(ATTESTATION)!;
    expect(claim.item.id).not.toBe(ATTESTATION.id);
    expect(claim.item.eventId).toBe(ATTESTATION.id);
  });

  it('round-trips back into what the resolvers expect', () => {
    const [claim] = decodeAttestation(ATTESTATION)!;
    const atts = attestationsFrom([claim.item as never]);
    expect(atts[0].id).toBe(ATTESTATION.id);
    const pk = '01c2adb79d1c55df26081710e4845836758921835362a5d889c68a3671b115a5';
    expect(attestationNameMap(atts).get(pk)).toBe('Samuel');
    expect(attestationIdentityMap(atts).get(pk)).toBe('telegram:1117779550');
  });

  it('ignores anything that is not an attestation', () => {
    expect(decodeAttestation(OCCURRENCE)).toBeNull();
    expect(decodeAttestation({ ...ATTESTATION, tags: [] })).toBeNull();
  });

  it('fetches the whole directory unless providers are pinned', () => {
    expect(createShiftIdentityWire().filters()).toEqual([{ kinds: [31926] }]);
    expect(createShiftIdentityWire({ providers: [COORD] }).filters())
      .toEqual([{ kinds: [31926], authors: [COORD] }]);
  });
});
