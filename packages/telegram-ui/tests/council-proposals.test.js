// Smoke test for the bot-side council facade.
// Verifies the @holons/core/council facade exports + HolonDB-shaped store
// adapter contract.

import { describe, expect, it } from 'vitest';
import {
  PROPOSAL_LENS,
  agree,
  applyVote,
  block,
  castVote,
  createAndSaveProposal,
  createProposal,
  hasAgreed,
  hasBlocked,
  saveProposal,
  subscribeToProposals,
  tallyVotes,
} from '../src/council/index.js';

function makeHolonDBLike() {
  const records = new Map();
  const subs = [];
  return {
    records,
    async put(_holon, _lens, data) {
      records.set(data.id, JSON.parse(JSON.stringify(data)));
      for (const cb of subs) cb(JSON.parse(JSON.stringify(data)), data.id);
    },
    async get(_holon, _lens, key) {
      const r = records.get(key);
      return r ? JSON.parse(JSON.stringify(r)) : null;
    },
    async delete(_holon, _lens, key) {
      records.delete(key);
    },
    async subscribe(_holon, _lens, cb) {
      subs.push(cb);
      return { unsubscribe: () => subs.splice(subs.indexOf(cb), 1) };
    },
  };
}

describe('telegram-ui council facade', () => {
  it('re-exports the canonical lens name', () => {
    expect(PROPOSAL_LENS).toBe('quests');
  });

  it('createProposal + saveProposal round-trip through the store', async () => {
    const db = makeHolonDBLike();
    const p = createProposal({ title: 'Test', creator: { id: 1, first_name: 'Bot' } });
    await saveProposal(db, '-1001', p);
    const back = db.records.get(p.id);
    expect(back?.title).toBe('Test');
    expect(back?.type).toBe('proposal');
  });

  it('agree / block toggle votes via castVote', async () => {
    const db = makeHolonDBLike();
    const p = await createAndSaveProposal(db, '-1001', { title: 'Vote me' });
    await agree(db, '-1001', p.id, { id: 42, first_name: 'Alice' });
    await block(db, '-1001', p.id, { id: 99, first_name: 'Bob' });
    const stored = db.records.get(p.id);
    expect(stored.participants.length).toBe(1);
    expect(stored.stoppers.length).toBe(1);
    expect(tallyVotes(stored).status).toBe('stopped');
  });

  it('castVote is a no-op for missing proposals', async () => {
    const db = makeHolonDBLike();
    const result = await castVote(db, 'h', 'missing', { id: 1 }, 'agree');
    expect(result).toBeNull();
  });

  it('applyVote is pure (no I/O) and reuses canonical rules', () => {
    const p = createProposal({ title: 'X' });
    const v = applyVote(p, { id: 7 }, 'agree');
    expect(hasAgreed(v, { id: 7 })).toBe(true);
    expect(hasBlocked(v, { id: 7 })).toBe(false);
  });

  it('subscribeToProposals filters non-proposal records', async () => {
    const db = makeHolonDBLike();
    const seen = [];
    const off = await subscribeToProposals(db, 'h', (data, key) => seen.push({ data, key }));
    await createAndSaveProposal(db, 'h', { title: 'P1' });
    // Quest (not a proposal) under same lens — should be filtered.
    await db.put('h', 'quests', { id: 'q1', type: 'quest', title: 'Q' });
    expect(seen.length).toBe(1);
    expect(seen[0].data.type).toBe('proposal');
    off();
  });
});
