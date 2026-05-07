import { describe, expect, it } from 'vitest';
import type { Proposal, ProposalStore } from './types.js';
import {
  agree,
  block,
  castVote,
  createAndSaveProposal,
  createProposal,
  saveProposal,
  subscribeToProposals,
} from './proposals.js';

function makeStore(): ProposalStore & {
  records: Map<string, Proposal>;
  subs: Array<(data: Proposal | null, key?: string) => void>;
} {
  const records = new Map<string, Proposal>();
  const subs: Array<(data: Proposal | null, key?: string) => void> = [];
  return {
    records,
    subs,
    async put(_holon, _lens, data) {
      records.set(data.id, JSON.parse(JSON.stringify(data)));
      for (const cb of subs) cb(JSON.parse(JSON.stringify(data)), data.id);
    },
    async get(_holon, _lens, key) {
      const r = records.get(key);
      return r ? JSON.parse(JSON.stringify(r)) : null;
    },
    async delete(_holon, _lens, key) {
      const had = records.delete(key);
      if (had) for (const cb of subs) cb(null, key);
      return had;
    },
    async subscribe(_holon, _lens, cb) {
      subs.push(cb);
      return { unsubscribe: () => subs.splice(subs.indexOf(cb), 1) };
    },
  };
}

describe('createProposal', () => {
  it('builds a well-formed proposal', () => {
    const p = createProposal({ title: 'Test', description: 'desc', creator: 'alice' });
    expect(p.type).toBe('proposal');
    expect(p.title).toBe('Test');
    expect(p.participants).toEqual([]);
    expect(p.stoppers).toEqual([]);
    expect(p.status).toBe('ongoing');
    expect(typeof p.id).toBe('string');
  });

  it('rejects empty titles', () => {
    expect(() => createProposal({ title: '   ' })).toThrow();
  });
});

describe('persistence', () => {
  it('createAndSaveProposal writes to the store', async () => {
    const store = makeStore();
    const p = await createAndSaveProposal(store, 'holon-1', { title: 'Hi', creator: 'alice' });
    expect(store.records.get(p.id)?.title).toBe('Hi');
  });

  it('saveProposal puts under the quests lens', async () => {
    const store = makeStore();
    const p = createProposal({ title: 'Lens test' });
    await saveProposal(store, 'holon-1', p);
    expect(store.records.get(p.id)).toBeDefined();
  });

  it('castVote reads, applies, writes', async () => {
    const store = makeStore();
    const p = await createAndSaveProposal(store, 'h', { title: 'Quorum?' });
    const updated = await castVote(store, 'h', p.id, 'voter-1', 'agree');
    expect(updated?.participants.length).toBe(1);
    expect(store.records.get(p.id)?.participants.length).toBe(1);
  });

  it('agree / block helpers route correctly', async () => {
    const store = makeStore();
    const p = await createAndSaveProposal(store, 'h', { title: 'X' });
    await agree(store, 'h', p.id, 'a');
    await block(store, 'h', p.id, 'b');
    const stored = store.records.get(p.id)!;
    expect(stored.participants.length).toBe(1);
    expect(stored.stoppers.length).toBe(1);
    expect(stored.status).toBe('stopped');
  });

  it('castVote returns null for missing proposals', async () => {
    const store = makeStore();
    const result = await castVote(store, 'h', 'nope', 'a', 'agree');
    expect(result).toBeNull();
  });

  it('subscribeToProposals filters non-proposal records', async () => {
    const store = makeStore();
    const seen: Array<{ data: Proposal | null; key?: string }> = [];
    const off = await subscribeToProposals(store, 'h', (data, key) => seen.push({ data, key }));

    await createAndSaveProposal(store, 'h', { title: 'Yes' });
    // Simulate a quest (not a proposal) being written to the same lens.
    await store.put('h', 'quests', { id: 'q1', type: 'quest', title: 'Q' } as unknown as Proposal);

    expect(seen.length).toBe(1);
    expect(seen[0].data?.type).toBe('proposal');

    off();
  });
});
