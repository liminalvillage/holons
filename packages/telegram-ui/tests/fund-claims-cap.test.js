// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// /fundclaim under the ceiling: a member's claim past what is left of their
// right is refused before anything is written; one within it is recorded.
import { describe, it, expect } from 'vitest';
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from 'nostr-tools/pure';
import { HOLOSPHERE_LOG_KIND, logRefs } from 'holosphere/nostr-events.js';
import { buildMint } from '@holons/core/flows';
import FundClaims from '../src/FundClaims.js';

const SECRET = 'test-derivation-secret';
const HOLON = '-100';
const ticking = () => {
  let t = 1_770_000_000_000;
  return () => (t += 1000);
};

/** A holosphere stand-in: signed logs under the holon key, a settings doc with a custom split, two users. */
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
        return {
          id: HOLON,
          holonPubkey: pk,
          admin: '1',
          allocation: {
            interiorPercent: 100,
            steepness: 50,
            nzones: 1,
            interiorMode: 'custom',
            shares: { 1: 1, 2: 1 },
          },
        };
      return null;
    },
    async getAll(holon, lens) {
      if (lens === 'users' && holon === HOLON)
        return [
          { id: 1, first_name: 'Alice' },
          { id: 2, first_name: 'Bob' },
        ];
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

describe('FundClaims under the ceiling', () => {
  it('refuses a claim past what is left of the right without writing, records one within it', async () => {
    const db = fakeDb();
    // 100 L in the fund, minted by the holon key (the bootstrap admin, an attester).
    const mint = buildMint({ amount: 100, unit: 'L', at: 1_760_000_000_000 });
    await db.append(HOLON, 'flow_mints', mint.item, { refs: mint.refs });
    const claims = new FundClaims(null, db, {
      derivationSecret: SECRET,
      now: ticking(),
      checkpoints: false,
    });

    // Alice holds half: 50 L. 80 L is past it.
    let c = ctxFor(1, '/fundclaim 80 L jugs');
    await claims.claim(c);
    expect(c.replies[0]).toMatch(/You can claim up to 50 L here/);
    expect(await db.getLog(HOLON, 'flow_claims')).toHaveLength(0);

    c = ctxFor(1, '/fundclaim 40 L jugs');
    await claims.claim(c);
    expect(c.replies[0]).toMatch(/Claim recorded: 40 L/);
    expect(await db.getLog(HOLON, 'flow_claims')).toHaveLength(1);

    // What is left is 10 L, pending or not.
    c = ctxFor(1, '/fundclaim 20 L');
    await claims.claim(c);
    expect(c.replies[0]).toMatch(/You can claim up to 10 L here/);

    // A unit with no pot is a ceiling of zero: nothing minted, nothing to claim.
    c = ctxFor(2, '/fundclaim 500 EUR');
    await claims.claim(c);
    expect(c.replies[0]).toMatch(/You can claim up to 0 EUR here/);
    expect(await db.getLog(HOLON, 'flow_claims')).toHaveLength(1);
  });
});
