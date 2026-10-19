// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The Artisan fork in a project's chat: a group admin claims the project
// (its split and codes land on the chat, the fund aliases it), a member
// claims their seat, flags need, exits; a locked split refuses to move.
import { describe, it, expect } from 'vitest';
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from 'nostr-tools/pure';
import { HOLOSPHERE_LOG_KIND, logRefs } from 'holosphere/nostr-events.js';
import { createHash } from 'node:crypto';
import { buildStandingVerdict } from '@holons/core/flows';
import ArtisanFork, { codeHash } from '../src/ArtisanFork.js';
import { flowsUrl } from '../src/flowsLink.js';

const SECRET = 'test-derivation-secret';
const CHAT = '-100';
const FUND = 'holon_fundfundfundfund';
const PROJECT = 'holon_projprojprojproj';
const CODE = 'h5w8bhj4ff7d';
const CREDIT = '2tag53td4ur8';
const ticking = () => {
  let t = 1_770_000_000_000;
  return () => (t += 1000);
};

function fakeDb() {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const logs = new Map();
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
  const settings = {
    [CHAT]: { id: CHAT, holonPubkey: pk, admin: '1', name: 'Soil Lab chat' },
    [FUND]: {
      id: FUND,
      name: 'Regen Fund',
      holonPubkey: pk,
      allocation: {
        interiorPercent: 100,
        interiorMode: 'custom',
        buckets: [
          {
            id: 'legacy',
            percent: 100,
            mode: 'custom',
            shares: { [PROJECT]: 3000 },
          },
        ],
        codes: { [codeHash(CODE)]: PROJECT },
      },
    },
    [PROJECT]: {
      id: PROJECT,
      name: 'Soil Lab',
      holonPubkey: pk,
      allocation: {
        interiorPercent: 100,
        interiorMode: 'custom',
        buckets: [
          {
            id: 'legacy',
            percent: 40,
            mode: 'custom',
            shares: { 111: 2000, 'artisan:u2': 1000 },
          },
          { id: 'needs', percent: 30, mode: 'needs' },
          { id: 'impact', percent: 30, mode: 'equation' },
        ],
        codes: { [codeHash(CREDIT)]: 'artisan:u2' },
      },
    },
  };
  return {
    pk,
    settings,
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
      if (lens === 'settings' && id === holon) return settings[holon] ?? null;
      return null;
    },
    async put(holon, lens, doc) {
      if (lens === 'settings') settings[holon] = doc;
      return true;
    },
    async getAll(holon, lens) {
      if (lens === 'users' && holon === CHAT)
        return [
          { id: 1, first_name: 'Alice' },
          { id: 2, first_name: 'Bo' },
          { id: 111, first_name: 'Ada' },
        ];
      return [];
    },
    async getAllGlobal() {
      return [];
    },
    async federateHolon() {
      return true;
    },
    async getFederation() {
      return { federated: [], partnerNames: {} };
    },
    store: { listEventIds: () => [], getEvents: () => [] },
    async ready() {},
  };
}

const ctxFor = (userId, text, { admin = false } = {}) => {
  const replies = [];
  return {
    replies,
    message: { text },
    chat: { id: Number(CHAT), type: 'supergroup', title: 'Soil Lab chat' },
    from: { id: userId },
    update: {
      message: { text, from: { id: userId }, chat: { id: Number(CHAT) } },
    },
    telegram: {
      getChatMember: async () => ({
        status: admin ? 'administrator' : 'member',
      }),
    },
    reply: t => (replies.push(t), Promise.resolve()),
    replyWithHTML: t => (replies.push(t), Promise.resolve()),
  };
};

describe('ArtisanFork', () => {
  it('a group admin claims the project; a member claims a seat, flags need and exits', async () => {
    const db = fakeDb();
    const fork = new ArtisanFork(null, db, {
      derivationSecret: SECRET,
      now: ticking(),
    });

    let c = ctxFor(1, `/claimproject ${FUND}_${CODE}`);
    await fork.claimProject(c);
    expect(c.replies[0]).toMatch(/Only an admin/);

    c = ctxFor(1, `/claimproject ${FUND}_${CODE}`, { admin: true });
    await fork.claimProject(c);
    expect(c.replies[0]).toMatch(/is now <b>Soil Lab<\/b> in fund Regen Fund/);
    expect(c.replies[0]).toMatch(/2 seats carried over, 1 waiting/);
    expect(c.replies[0]).toMatch(/Split.*legacy 40% · needs 30% · impact 30%/);
    // the chat carries the project's split and codes; the fund seats the chat in the project's place
    expect(db.settings[CHAT].allocation.buckets.map(b => b.id)).toEqual([
      'legacy',
      'needs',
      'impact',
    ]);
    expect(db.settings[FUND].allocation.aliases).toEqual({ [PROJECT]: CHAT });
    expect(db.settings[FUND].allocation.codes).toBeUndefined();

    c = ctxFor(1, `/claimproject ${FUND}_${CODE}`, { admin: true });
    await fork.claimProject(c);
    expect(c.replies[0]).toMatch(/not open/);

    // a member claims the placeholder's seat
    c = ctxFor(2, `/claimcredit ${CREDIT}`);
    await fork.claimCredit(c);
    expect(c.replies[0]).toMatch(
      /Your seat is yours: 1000 owed \(33.3% of the legacy credit\)/
    );
    expect(db.settings[CHAT].allocation.aliases).toEqual({ 'artisan:u2': '2' });
    c = ctxFor(3, `/claimcredit ${CREDIT}`);
    await fork.claimCredit(c);
    expect(c.replies[0]).toMatch(/not open here/);

    // /split shows the composed roster with the alias resolved
    c = ctxFor(2, '/split');
    await fork.split(c);
    expect(c.replies[0]).toMatch(
      /<b>legacy<\/b> \(custom\): .*2000|<b>legacy<\/b> \(custom\): /
    );
    expect(c.replies[0]).toMatch(/needs.*nobody in it yet/);

    // a wallet on the member's own record
    c = ctxFor(2, '/wallet 0x' + 'a'.repeat(40));
    await fork.wallet(c);
    expect(c.replies[0]).toMatch(/Wallet set: 0xaaaa/);
    expect(db.settings['2'].payout.address).toBe('0x' + 'a'.repeat(40));

    // needs: a member's flag waits for an attester; the bootstrap admin (user 1) attests
    c = ctxFor(2, '/needs on rent is due');
    await fork.needs(c);
    expect(c.replies[0]).toMatch(/Flag recorded: on/);
    expect(c.replies[0]).toMatch(/pending/);
    const id = /#([0-9a-f]{8})/.exec(c.replies[0])[1];
    // a member's word does not attest; the holon key's (the bootstrap admin) does
    c = ctxFor(1, `/needsattest ${id}`);
    await fork.needsVerdict(c, 'attest');
    expect(c.replies[0]).toMatch(/Attested .*pending/);
    const flag = (await db.getLog(CHAT, 'flow_needs')).find(e =>
      e.id.startsWith(id)
    );
    const yes = buildStandingVerdict(flag.id, 'attest');
    await db.append(CHAT, 'flow_needs', yes.item, { refs: yes.refs });
    c = ctxFor(2, '/needs');
    await fork.needs(c);
    expect(c.replies[0]).toMatch(/In need: /);

    // exit: asks first, then records on "yes"
    c = ctxFor(2, '/exit');
    await fork.exit(c);
    expect(c.replies[0]).toMatch(/Exit retires your seat/);
    expect(await db.getLog(CHAT, 'flow_exits')).toHaveLength(0);
    c = ctxFor(2, '/exit yes');
    await fork.exit(c);
    expect(c.replies[0]).toMatch(/Exit recorded.*accepted/s);
    c = ctxFor(2, '/exit');
    await fork.exit(c);
    expect(c.replies[0]).toMatch(/already exited/);
    c = ctxFor(1, '/split');
    await fork.split(c);
    expect(c.replies[0]).toMatch(/Exited: /);
  });

  it('an admin moves the percents unless the split is locked at genesis', async () => {
    const db = fakeDb();
    const fork = new ArtisanFork(null, db, {
      derivationSecret: SECRET,
      now: ticking(),
    });
    db.settings[CHAT].allocation = db.settings[PROJECT].allocation;
    let c = ctxFor(2, '/split set legacy 50 needs 50 impact 0', {
      admin: false,
    });
    await fork.split(c);
    expect(c.replies[0]).toMatch(/Only an admin/);
    c = ctxFor(1, '/split set legacy 50 needs 50 impact 0', { admin: true });
    await fork.split(c);
    expect(c.replies[0]).toMatch(/Split set: legacy 50 · needs 50 · impact 0/);
    expect(db.settings[CHAT].allocation.buckets.map(b => b.percent)).toEqual([
      50, 50, 0,
    ]);

    const hash = createHash('sha256').update('x').digest('hex');
    db.settings[CHAT].allocation.genesis = { hash, at: 1 };
    c = ctxFor(1, '/split set legacy 60', { admin: true });
    await fork.split(c);
    expect(c.replies[0]).toMatch(/fixed at genesis/);
    expect(db.settings[CHAT].allocation.buckets.map(b => b.percent)).toEqual([
      50, 50, 0,
    ]);
  });

  it('a project seated straight in a Pot is claimed with the code on its own holon', async () => {
    const db = fakeDb();
    const SEAT = 'k7m2pq9wx4tn';
    const OTHER = 'holon_otherfundother11';
    // the FUND fixture stands in for the Pot: it seats the project and is named by the seat claim
    db.settings[FUND].allocation.codes = {};
    db.settings[PROJECT].allocation.codes[codeHash(SEAT)] = `seat:${FUND}`;
    const federated = [];
    db.getFederation = async holon =>
      holon === PROJECT
        ? { federated: [FUND, OTHER], partnerNames: {} }
        : { federated: [], partnerNames: {} };
    db.federateHolon = async (a, b) => (federated.push([a, b]), true);
    const fork = new ArtisanFork(null, db, {
      derivationSecret: SECRET,
      now: ticking(),
    });

    const c = ctxFor(1, `/claimproject ${PROJECT}_${SEAT}`, { admin: true });
    await fork.claimProject(c);
    expect(c.replies[0]).toMatch(/is now <b>Soil Lab<\/b> in Regen Fund/);
    expect(c.replies[0]).toMatch(/Linked to 1 fund it was tied to/);
    // the seat's holder aliases the project to the chat; the chat keeps the credit code, not the spent seat claim
    expect(db.settings[FUND].allocation.aliases).toEqual({ [PROJECT]: CHAT });
    expect(Object.values(db.settings[CHAT].allocation.codes)).toEqual([
      'artisan:u2',
    ]);
    expect(Object.values(db.settings[PROJECT].allocation.codes ?? {})).toEqual([
      'artisan:u2',
    ]);
    // a fund the project was linked to aliases it too, so its zones reach the chat
    expect(db.settings[OTHER].allocation.aliases).toEqual({ [PROJECT]: CHAT });
    expect(federated).toEqual([
      [FUND, CHAT],
      [OTHER, CHAT],
    ]);

    const again = ctxFor(1, `/claimproject ${PROJECT}_${SEAT}`, {
      admin: true,
    });
    await fork.claimProject(again);
    expect(again.replies[0]).toMatch(/not open/);
  });

  it('a claim after the window closed is refused and the seat stays unclaimed', async () => {
    const db = fakeDb();
    const SEAT = 'k7m2pq9wx4tn';
    db.settings[FUND].allocation.codes = {};
    db.settings[FUND].allocation.claimWindow = { until: 5000, keep: [] };
    db.settings[PROJECT].allocation.codes[codeHash(SEAT)] = `seat:${FUND}`;
    const late = new ArtisanFork(null, db, {
      derivationSecret: SECRET,
      now: () => 5000,
    });
    const c = ctxFor(1, `/claimproject ${PROJECT}_${SEAT}`, { admin: true });
    await late.claimProject(c);
    expect(c.replies[0]).toMatch(/claim window closed on 1970-01-01/);
    expect(db.settings[FUND].allocation.aliases).toBeUndefined();
    expect(db.settings[CHAT]?.allocation?.buckets).toBeUndefined();

    const early = new ArtisanFork(null, db, {
      derivationSecret: SECRET,
      now: () => 4999,
    });
    const ok = ctxFor(1, `/claimproject ${PROJECT}_${SEAT}`, { admin: true });
    await early.claimProject(ok);
    expect(ok.replies[0]).toMatch(/is now <b>Soil Lab<\/b>/);
  });

  it('points at the explorer when the bot knows where it is, and prints no link when it does not', async () => {
    const db = fakeDb();
    const fork = new ArtisanFork(null, db, {
      derivationSecret: SECRET,
      now: ticking(),
    });
    const before = process.env.FLOWS_ADDRESS;
    try {
      delete process.env.FLOWS_ADDRESS;
      expect(flowsUrl('h', CHAT)).toBe('');
      let c = ctxFor(2, '/wallet');
      await fork.wallet(c);
      expect(c.replies[0]).not.toMatch(/https?:/);

      process.env.FLOWS_ADDRESS = 'https://flows.example/';
      expect(flowsUrl('h', CHAT)).toBe('https://flows.example/h/-100');
      expect(flowsUrl('p', 'artisan:u2')).toBe(
        'https://flows.example/p/artisan%3Au2'
      );
      expect(flowsUrl('x', CHAT)).toBe('');
      expect(flowsUrl('p', '')).toBe('');

      c = ctxFor(2, '/wallet');
      await fork.wallet(c);
      expect(c.replies[0]).toMatch(
        /Your flows: https:\/\/flows\.example\/p\/2$/
      );
      c = ctxFor(1, `/claimproject ${FUND}_${CODE}`, { admin: true });
      await fork.claimProject(c);
      expect(c.replies[0]).toMatch(
        /Its flows: https:\/\/flows\.example\/h\/-100$/
      );
      c = ctxFor(1, '/split');
      await fork.split(c);
      expect(c.replies[0]).toMatch(
        /As a diagram: https:\/\/flows\.example\/h\/-100$/
      );
    } finally {
      if (before === undefined) delete process.env.FLOWS_ADDRESS;
      else process.env.FLOWS_ADDRESS = before;
    }
  });
});
