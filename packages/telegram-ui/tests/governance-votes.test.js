// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from 'nostr-tools/pure';
import { HOLOSPHERE_LOG_KIND, logRefs } from 'holosphere/nostr-events.js';
import GovernanceVotes from '../src/GovernanceVotes.js';

const SECRET = 'test-derivation-secret';
const HOLON = '-100';
/** A clock that moves one second per call, so log order is the order of the calls. */
const ticking = () => {
  let t = 1_770_000_000_000;
  return () => (t += 1000);
};

/** A holosphere stand-in: append-only logs signed with the holon key, a users lens, a proposal. */
function fakeDb() {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const logs = new Map(); // `${holon}|${lens}` → LogEvent[]
  const log = (holon, lens) => {
    const k = `${holon}|${lens}`;
    if (!logs.has(k)) logs.set(k, []);
    return logs.get(k);
  };
  const entryOf = event => ({
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    refs: logRefs(event),
    item: JSON.parse(event.content),
  });
  let clock = 1_760_000_000;
  const quests = [
    { id: 'p1', type: 'proposal', title: 'Buy a shared drill' },
    { id: 'q1', type: 'task', title: 'Not a proposal' },
  ];
  return {
    pk,
    appname: 'T',
    currentPubkey: pk,
    signingEnabled: true,
    async getLog(holon, lens) {
      return [...log(holon, lens)];
    },
    async append(holon, lens, item, { refs, created_at } = {}) {
      const tags = [
        ['h', holon],
        ['l', lens],
      ];
      for (const [marker, v] of Object.entries(refs ?? {}))
        for (const id of Array.isArray(v) ? v : [v])
          if (id) tags.push(['e', String(id), '', marker]);
      tags.push(['n', 'T']);
      const event = finalizeEvent(
        {
          kind: HOLOSPHERE_LOG_KIND,
          created_at: created_at ?? clock++,
          tags,
          content: JSON.stringify(item),
        },
        sk
      );
      log(holon, lens).push(entryOf(event));
      return event;
    },
    async appendSigned(event) {
      const holon = event.tags.find(t => t[0] === 'h')?.[1];
      const lens = event.tags.find(t => t[0] === 'l')?.[1];
      log(holon, lens).push(entryOf(event));
      return { applied: true };
    },
    async get(holon, lens, id) {
      if (lens === 'settings' && id === HOLON)
        return { id: HOLON, holonPubkey: pk, admin: '1' };
      return null;
    },
    async getAll(holon, lens) {
      if (lens === 'users')
        return [
          { id: 1, first_name: 'Alice' },
          { id: 2, first_name: 'Bob' },
          { id: 3, first_name: 'Cy' },
        ];
      if (lens === 'quests') return quests;
      return [];
    },
    async getAllGlobal() {
      return [];
    },
    store: { listEventIds: () => [], getEvents: () => [] },
    async ready() {},
    async listHolons() {
      return [HOLON];
    },
  };
}

const ctxFor = (userId, text) => {
  const replies = [];
  return {
    replies,
    message: { text },
    chat: { id: Number(HOLON), type: 'supergroup' },
    update: {
      message: { text, from: { id: userId }, chat: { id: Number(HOLON) } },
    },
    reply: t => (replies.push(t), Promise.resolve()),
    replyWithHTML: t => (replies.push(t), Promise.resolve()),
  };
};

describe('GovernanceVotes', () => {
  it('casts signed ballots, counts one per member (the newest) and tallies over the roster', async () => {
    const db = fakeDb();
    const votes = new GovernanceVotes(null, db, {
      derivationSecret: SECRET,
      now: ticking(),
    });

    let c = ctxFor(1, '/vote drill yes because we need it');
    await votes.vote(c);
    expect(c.replies[0]).toMatch(/Voted yes on “Buy a shared drill”/);
    expect(c.replies[0]).toMatch(
      /Yes 1 · No 0 · Abstain 0 · of 3 — not passing/
    );

    c = ctxFor(2, '/vote p1 no');
    await votes.vote(c);
    expect(c.replies[0]).toMatch(/Yes 1 · No 1 · Abstain 0 · of 3/);

    // A change of mind is a newer entry; the earlier one is superseded.
    c = ctxFor(1, '/vote p1 abstain');
    await votes.vote(c);
    expect(c.replies[0]).toMatch(/Yes 0 · No 1 · Abstain 1 · of 3/);

    const entries = await db.getLog(HOLON, 'governance_votes');
    expect(entries).toHaveLength(3);
    // Signed by the members' derived keys, not the holon key.
    expect(new Set(entries.map(e => e.pubkey)).size).toBe(2);
    expect(entries.every(e => e.pubkey !== db.pk)).toBe(true);

    c = ctxFor(3, '/votes drill');
    await votes.list(c);
    expect(c.replies[0]).toMatch(/Buy a shared drill/);
    expect(c.replies[0]).toMatch(/🤷 <b>Alice<\/b>/);
    expect(c.replies[0]).toMatch(/👎 <b>Bob<\/b>/);
    expect(c.replies[0]).not.toMatch(/👍/);

    c = ctxFor(3, '/votes');
    await votes.list(c);
    expect(c.replies[0]).toMatch(/Proposals/);
    expect(c.replies[0]).not.toMatch(/Not a proposal/);
  });

  it('refuses a bad choice or an unknown proposal without writing', async () => {
    const db = fakeDb();
    const votes = new GovernanceVotes(null, db, {
      derivationSecret: SECRET,
      now: ticking(),
    });
    let c = ctxFor(1, '/vote drill maybe');
    await votes.vote(c);
    expect(c.replies[0]).toMatch(/Usage/);
    c = ctxFor(1, '/vote hammer yes');
    await votes.vote(c);
    expect(c.replies[0]).toMatch(/No proposal matches/);
    expect(await db.getLog(HOLON, 'governance_votes')).toHaveLength(0);
  });

  it("without a derivation secret the holon key votes on the member's behalf", async () => {
    const db = fakeDb();
    const votes = new GovernanceVotes(null, db, {
      derivationSecret: '',
      now: ticking(),
    });
    const c = ctxFor(2, '/vote p1 yes');
    await votes.vote(c);
    expect(c.replies[0]).toMatch(/on your behalf/);
    expect(c.replies[0]).toMatch(/Yes 1 · No 0/);
    const [e] = await db.getLog(HOLON, 'governance_votes');
    expect(e.pubkey).toBe(db.pk);
    expect(e.item.onBehalfOf).toBe('2');
  });
});
