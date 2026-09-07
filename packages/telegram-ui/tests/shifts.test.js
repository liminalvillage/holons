import { describe, it, expect, vi } from 'vitest';
import { deriveTelegramNostrKey } from '@holons/core/auth';
import {
  SHIFTS_LENS,
  SHIFT_IDENTITY_LENS,
  SHIFT_RSVP_LENS,
  decodeShiftEvent,
  parseShiftOccurrence,
  parseShiftRsvp,
} from '@holons/core/shifts';
import Shifts, { shiftRelaysFromEnv } from '../src/Shifts.js';

const SECRET = 'test-derivation-secret';
const COORD =
  '3f432836bece7b0a06dcbaef023f113fdcb10f96fbf98f35dd2e3b3a3c0e2dcb';
const GROUP = '-5459621960';

const OCC_EVENT = {
  content: '',
  created_at: 1788078250,
  id: 'occ1',
  kind: 31923,
  pubkey: COORD,
  tags: [
    ['d', `shift-${GROUP}-2026-08-30-dp`],
    ['title', 'Dinner Preparation'],
    ['start', '1788100200'],
    ['end', '1788107400'],
    ['start_tzid', 'Europe/Brussels'],
    ['capacity', '2'],
    ['t', 'shift'],
    ['t', 'dp'],
    ['t', `group-${GROUP}`],
  ],
};
const occurrence = parseShiftOccurrence(OCC_EVENT);
/** The same occurrence as the lens record the wire decodes it into. */
const occRecord = decodeShiftEvent(OCC_EVENT)[0].item;
const OCC_ID = `${occurrence.date}-${occurrence.code}`;

/**
 * In-memory stand-in for the relay client. Publishing ONLY: the schedule is
 * lens data now and comes from `fakeDb`.
 */
function fakeClient() {
  return {
    relays: ['wss://fake'],
    publishRsvp: vi.fn(async ({ occurrence: occ, status, previous }) => {
      // The real client signs; here we just record what a verified event would parse to.
      const created_at = previous ? previous.createdAt + 1 : 1000;
      const event = {
        kind: 31925,
        pubkey: 'set-by-test',
        created_at,
        id: String(created_at),
        content: '',
        tags: [
          ['a', occ.address],
          ['d', occ.dTag.replace(/^shift-/, 'rsvp-')],
          ['status', status],
          ['t', 'shift'],
        ],
      };
      return { event, results: [{ status: 'fulfilled', value: 'ok' }] };
    }),
  };
}

/**
 * `text` matters now: the schedule is filtered by the command's range, where
 * the old fake client ignored it and always returned the fixture. The
 * occurrence sits on 2026-08-30, so a render test asks for that day.
 */
function ctxFor(userId, callbackData, text = '/shifts') {
  return {
    chat: { id: Number(GROUP) },
    from: { id: userId },
    match: callbackData
      ? [callbackData, callbackData.replace(/^shift_(take|drop)_/, '')]
      : undefined,
    message: { text },
    callbackQuery: {
      message: {
        chat: { id: Number(GROUP) },
        message_id: 7,
        text: '📅 Shifts this week',
      },
    },
    reply: vi.fn(async () => ({ message_id: 7 })),
    answerCbQuery: vi.fn(async () => {}),
    editMessageText: vi.fn(async () => {}),
  };
}

// A signup and an attestation as the LENS RECORDS the wires decode them into.
// The tests still speak the protocol shapes, which is what the bot renders.
const rsvpRecord = r => ({
  id: `${OCC_ID}|${r.pubkey}`,
  occurrence: OCC_ID,
  dTag: r.dTag,
  pubkey: r.pubkey,
  status: r.status,
  address: r.address,
  createdAt: r.createdAt,
  ...(r.changedBy ? { changedBy: r.changedBy } : {}),
  eventId: r.id,
});
const attRecord = a => ({
  ...a,
  id: `${a.provider}|${a.identifier}`,
  eventId: a.id,
});

/**
 * The holon's store: the users lens the bot names members from, plus the three
 * shift lenses the schedule is read from.
 */
function fakeDb() {
  const rsvps = [];
  const attestations = [];
  let identityFails = false;
  return {
    rsvps,
    attestations,
    /** Make the global identity read fail, as an unreachable relay would. */
    breakIdentity: () => {
      identityFails = true;
    },
    getAll: async (_holon, lens) => {
      if (lens === SHIFTS_LENS) return [occRecord];
      if (lens === SHIFT_RSVP_LENS) return rsvps.map(rsvpRecord);
      return [
        { id: 1, first_name: 'Alice' },
        { id: 2, first_name: 'Bob' },
      ];
    },
    getAllGlobal: async lens => {
      if (identityFails) throw new Error('relay down');
      return lens === SHIFT_IDENTITY_LENS ? attestations.map(attRecord) : [];
    },
  };
}

describe('shiftRelaysFromEnv', () => {
  it('prefers SHIFTS_RELAYS, then HOLOSPHERE_RELAYS, then the default', () => {
    expect(shiftRelaysFromEnv({ SHIFTS_RELAYS: 'wss://a, wss://b' })).toEqual([
      'wss://a',
      'wss://b',
    ]);
    expect(shiftRelaysFromEnv({ HOLOSPHERE_RELAYS: 'wss://c' })).toEqual([
      'wss://c',
    ]);
    expect(shiftRelaysFromEnv({})).toEqual(['wss://relay.holons.io']);
  });
});

describe('Shifts', () => {
  it('renders the schedule with names resolved from derived keys', async () => {
    const client = fakeClient();
    const db = fakeDb();
    const alice = deriveTelegramNostrKey(1, SECRET).publicKey;
    db.rsvps.push(
      parseShiftRsvp({
        kind: 31925,
        pubkey: alice,
        created_at: 5,
        id: 'r1',
        content: '',
        tags: [
          ['a', occurrence.address],
          ['d', 'x'],
          ['status', 'accepted'],
          ['t', 'shift'],
        ],
      })
    );
    const shifts = new Shifts(null, db, { client, derivationSecret: SECRET });
    const ctx = ctxFor(2, undefined, '/shifts 2026-08-30');
    await shifts.list(ctx);
    const [text, extra] = ctx.reply.mock.calls[0];
    expect(text).toContain('Dinner Preparation');
    expect(text).toContain('(1/2): Alice');
    expect(text).toContain('Europe/Brussels');
    const buttons = extra.reply_markup.inline_keyboard
      .flat()
      .map(b => b.callback_data);
    expect(buttons).toEqual([
      `shift_take_${occurrence.dTag}`,
      `shift_drop_${occurrence.dTag}`,
    ]);
  });

  it('names Elinor-side participants from 31926 attestations, local lens winning', async () => {
    const client = fakeClient();
    const db = fakeDb();
    const alice = deriveTelegramNostrKey(1, SECRET).publicKey;
    const stranger = 'e'.repeat(64);
    for (const pk of [alice, stranger]) {
      db.rsvps.push(
        parseShiftRsvp({
          kind: 31925,
          pubkey: pk,
          created_at: 5,
          id: `r-${pk.slice(0, 4)}`,
          content: '',
          tags: [
            ['a', occurrence.address],
            ['d', 'x'],
            ['status', 'accepted'],
            ['t', 'shift'],
          ],
        })
      );
    }
    db.attestations.push(
      // Elinor's coordinator knows the stranger…
      {
        provider: COORD,
        identifier: 'telegram:9',
        platform: 'telegram',
        platformId: '9',
        pubkeys: [stranger],
        name: 'Carol',
        createdAt: 10,
        id: 'a1',
      },
      // …and claims a name for Alice too, but the local lens must win.
      {
        provider: COORD,
        identifier: 'telegram:1',
        platform: 'telegram',
        platformId: '1',
        pubkeys: [alice],
        name: 'Not Alice',
        createdAt: 10,
        id: 'a2',
      }
    );
    const shifts = new Shifts(null, db, {
      client,
      derivationSecret: SECRET,
      coordinatorPubkey: COORD,
    });
    const ctx = ctxFor(2, undefined, '/shifts 2026-08-30');
    await shifts.list(ctx);
    const [text] = ctx.reply.mock.calls[0];
    expect(text).toContain('Carol');
    expect(text).toContain('Alice');
    expect(text).not.toContain('Not Alice');
    expect(text).not.toContain(`${stranger.slice(0, 8)}…`);
    // The whole directory is read, not just our members: a lens-named member
    // still needs their sibling keys linked for the person-identity collapse,
    // and a stranger is named from it alone.
    expect(text).toContain('Alice');
    expect(text).toContain('Carol');
  });

  it('falls back to hex prefixes when the attestation fetch fails', async () => {
    const client = fakeClient();
    const db = fakeDb();
    const stranger = 'e'.repeat(64);
    db.rsvps.push(
      parseShiftRsvp({
        kind: 31925,
        pubkey: stranger,
        created_at: 5,
        id: 'r1',
        content: '',
        tags: [
          ['a', occurrence.address],
          ['d', 'x'],
          ['status', 'accepted'],
          ['t', 'shift'],
        ],
      })
    );
    db.breakIdentity();
    const shifts = new Shifts(null, db, { client, derivationSecret: SECRET });
    const ctx = ctxFor(2, undefined, '/shifts 2026-08-30');
    await shifts.list(ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain(`${stranger.slice(0, 8)}…`);
  });

  it("publishes an accepted RSVP with the tapping user's key and refreshes", async () => {
    const client = fakeClient();
    const db = fakeDb();
    const shifts = new Shifts(null, db, { client, derivationSecret: SECRET });
    const ctx = ctxFor(2, `shift_take_${occurrence.dTag}`);
    await shifts.rsvp(ctx, 'accepted');
    expect(client.publishRsvp).toHaveBeenCalledTimes(1);
    const call = client.publishRsvp.mock.calls[0][0];
    expect(call.status).toBe('accepted');
    // The identity context hands out signers, never keys.
    expect(call.participantPrivateKey).toBeUndefined();
    expect(call.signer.pubkey).toBe(
      deriveTelegramNostrKey(2, SECRET).publicKey
    );
    expect(call.occurrence.dTag).toBe(occurrence.dTag);
    expect(ctx.answerCbQuery.mock.calls[0][0]).toMatch(/You're on/);
    expect(ctx.editMessageText).toHaveBeenCalled();
  });

  it('refuses to sign up when the shift is full', async () => {
    const client = fakeClient();
    const db = fakeDb();
    for (const id of [10, 11]) {
      db.rsvps.push(
        parseShiftRsvp({
          kind: 31925,
          pubkey: deriveTelegramNostrKey(id, SECRET).publicKey,
          created_at: 5,
          id: `r${id}`,
          content: '',
          tags: [
            ['a', occurrence.address],
            ['d', 'x'],
            ['status', 'accepted'],
            ['t', 'shift'],
          ],
        })
      );
    }
    const shifts = new Shifts(null, db, { client, derivationSecret: SECRET });
    const ctx = ctxFor(2, `shift_take_${occurrence.dTag}`);
    await shifts.rsvp(ctx, 'accepted');
    expect(client.publishRsvp).not.toHaveBeenCalled();
    expect(ctx.answerCbQuery.mock.calls[0][0]).toMatch(/full/);
  });

  it('lets a member drop a shift they took under an attestation-linked sibling key', async () => {
    // The live cross-app case: signed up via Elinor (Elinor-side key), then
    // taps ❌ Drop here — the bot signs with the member's DERIVED key, and
    // the 31926 attestation is what makes them the same person.
    const client = fakeClient();
    const db = fakeDb();
    const elinorKey = 'e'.repeat(64);
    const derived = deriveTelegramNostrKey(2, SECRET).publicKey;
    db.rsvps.push(
      parseShiftRsvp({
        kind: 31925,
        pubkey: elinorKey,
        created_at: 5,
        id: 'r-elinor',
        content: '',
        tags: [
          ['a', occurrence.address],
          ['d', 'x'],
          ['status', 'accepted'],
          ['t', 'shift'],
        ],
      })
    );
    db.attestations.push({
      provider: COORD,
      identifier: 'telegram:2',
      platform: 'telegram',
      platformId: '2',
      pubkeys: [elinorKey, derived],
      name: 'Bob',
      createdAt: 10,
      id: 'a1',
    });
    const shifts = new Shifts(null, db, {
      client,
      derivationSecret: SECRET,
      coordinatorPubkey: COORD,
    });

    // Take is refused — the person is already on via the sibling key.
    const takeCtx = ctxFor(2, `shift_take_${occurrence.dTag}`);
    await shifts.rsvp(takeCtx, 'accepted');
    expect(client.publishRsvp).not.toHaveBeenCalled();
    expect(takeCtx.answerCbQuery.mock.calls[0][0]).toMatch(/already on/);

    // Drop goes through, out-timestamping the sibling key's signup.
    const dropCtx = ctxFor(2, `shift_drop_${occurrence.dTag}`);
    await shifts.rsvp(dropCtx, 'declined');
    expect(client.publishRsvp).toHaveBeenCalledTimes(1);
    const call = client.publishRsvp.mock.calls[0][0];
    expect(call.status).toBe('declined');
    expect(call.previous.pubkey).toBe(elinorKey);
    expect(dropCtx.answerCbQuery.mock.calls[0][0]).toMatch(/Dropped/);
  });

  it('ignores callbacks for another group and refuses without a derivation secret', async () => {
    const client = fakeClient();
    const db = fakeDb();
    const shifts = new Shifts(null, db, { client, derivationSecret: SECRET });
    const foreign = ctxFor(2, 'shift_take_shift--999-2026-08-30-dp');
    await shifts.rsvp(foreign, 'accepted');
    expect(client.publishRsvp).not.toHaveBeenCalled();
    expect(foreign.answerCbQuery.mock.calls[0][0]).toMatch(/Unknown shift/);

    const unconfigured = new Shifts(null, db, { client, derivationSecret: '' });
    const ctx = ctxFor(2, `shift_take_${occurrence.dTag}`);
    await unconfigured.rsvp(ctx, 'accepted');
    expect(ctx.answerCbQuery.mock.calls[0][0]).toMatch(/not configured/);
  });

  it('parses /shifts date arguments', () => {
    expect(Shifts.rangeFor('2026-08-30').dateOnly).toBe('2026-08-30');
    expect(Shifts.rangeFor('nope')).toBeNull();
    expect(Shifts.rangeFor('today', 1788100200).since).toBeLessThan(1788100200);
  });
});
