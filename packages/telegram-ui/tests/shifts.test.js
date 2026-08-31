import { describe, it, expect, vi } from 'vitest';
import { deriveTelegramNostrKey } from '@holons/core/auth';
import { parseShiftOccurrence, parseShiftRsvp } from '@holons/core/shifts';
import Shifts, { shiftRelaysFromEnv } from '../src/Shifts.js';

const SECRET = 'test-derivation-secret';
const COORD =
  '3f432836bece7b0a06dcbaef023f113fdcb10f96fbf98f35dd2e3b3a3c0e2dcb';
const GROUP = '-5459621960';

const occurrence = parseShiftOccurrence({
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
});

/** In-memory stand-in for the core relay client. */
function fakeClient() {
  const rsvps = [];
  const attestations = [];
  return {
    relays: ['wss://fake'],
    rsvps,
    attestations,
    fetchOccurrences: vi.fn(async () => [occurrence]),
    fetchRsvps: vi.fn(async () => rsvps.slice()),
    fetchSchedule: vi.fn(async () => ({
      occurrences: [occurrence],
      rsvps: rsvps.slice(),
    })),
    fetchAttestations: vi.fn(async ({ participants }) =>
      attestations.filter(a => a.pubkeys.some(pk => participants.includes(pk)))
    ),
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

function ctxFor(userId, callbackData) {
  return {
    chat: { id: Number(GROUP) },
    from: { id: userId },
    match: callbackData
      ? [callbackData, callbackData.replace(/^shift_(take|drop)_/, '')]
      : undefined,
    message: { text: '/shifts' },
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

const db = {
  getAll: async () => [
    { id: 1, first_name: 'Alice' },
    { id: 2, first_name: 'Bob' },
  ],
};

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
    const alice = deriveTelegramNostrKey(1, SECRET).publicKey;
    client.rsvps.push(
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
    const ctx = ctxFor(2);
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
    const alice = deriveTelegramNostrKey(1, SECRET).publicKey;
    const stranger = 'e'.repeat(64);
    for (const pk of [alice, stranger]) {
      client.rsvps.push(
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
    client.attestations.push(
      // Elinor's coordinator knows the stranger…
      { provider: COORD, identifier: 'telegram:9', platform: 'telegram', platformId: '9', pubkeys: [stranger], name: 'Carol', createdAt: 10, id: 'a1' },
      // …and claims a name for Alice too, but the local lens must win.
      { provider: COORD, identifier: 'telegram:1', platform: 'telegram', platformId: '1', pubkeys: [alice], name: 'Not Alice', createdAt: 10, id: 'a2' }
    );
    const shifts = new Shifts(null, db, { client, derivationSecret: SECRET, coordinatorPubkey: COORD });
    const ctx = ctxFor(2);
    await shifts.list(ctx);
    const [text] = ctx.reply.mock.calls[0];
    expect(text).toContain('Carol');
    expect(text).toContain('Alice');
    expect(text).not.toContain('Not Alice');
    expect(text).not.toContain(`${stranger.slice(0, 8)}…`);
    // Only the pubkeys the lens could not explain were looked up.
    expect(client.fetchAttestations.mock.calls[0][0].participants).toEqual([stranger]);
  });

  it('falls back to hex prefixes when the attestation fetch fails', async () => {
    const client = fakeClient();
    const stranger = 'e'.repeat(64);
    client.rsvps.push(
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
    client.fetchAttestations.mockRejectedValueOnce(new Error('relay down'));
    const shifts = new Shifts(null, db, { client, derivationSecret: SECRET });
    const ctx = ctxFor(2);
    await shifts.list(ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain(`${stranger.slice(0, 8)}…`);
  });

  it("publishes an accepted RSVP with the tapping user's key and refreshes", async () => {
    const client = fakeClient();
    const shifts = new Shifts(null, db, { client, derivationSecret: SECRET });
    const ctx = ctxFor(2, `shift_take_${occurrence.dTag}`);
    await shifts.rsvp(ctx, 'accepted');
    expect(client.publishRsvp).toHaveBeenCalledTimes(1);
    const call = client.publishRsvp.mock.calls[0][0];
    expect(call.status).toBe('accepted');
    // The identity context hands out signers, never keys.
    expect(call.participantPrivateKey).toBeUndefined();
    expect(call.signer.pubkey).toBe(deriveTelegramNostrKey(2, SECRET).publicKey);
    expect(call.occurrence.dTag).toBe(occurrence.dTag);
    expect(ctx.answerCbQuery.mock.calls[0][0]).toMatch(/You're on/);
    expect(ctx.editMessageText).toHaveBeenCalled();
  });

  it('refuses to sign up when the shift is full', async () => {
    const client = fakeClient();
    for (const id of [10, 11]) {
      client.rsvps.push(
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

  it('ignores callbacks for another group and refuses without a derivation secret', async () => {
    const client = fakeClient();
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
