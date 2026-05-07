import { describe, expect, it } from 'vitest';
import type { Proposal } from './types.js';
import { applyVote, deriveStatus, hasAgreed, hasBlocked, tallyVotes } from './voting.js';

const baseProposal: Proposal = {
  id: 'p1',
  type: 'proposal',
  title: 'Adopt new meeting cadence',
  description: 'Switch from weekly to bi-weekly all-hands.',
  participants: [],
  stoppers: [],
  date: 1700000000,
  creator: 'alice',
  status: 'ongoing',
};

describe('tallyVotes', () => {
  it('counts agreements and blocks', () => {
    const p: Proposal = { ...baseProposal, participants: ['a', 'b', 'c'], stoppers: ['x'] };
    const t = tallyVotes(p, 5);
    expect(t.agreements).toBe(3);
    expect(t.blocks).toBe(1);
    expect(t.netSupport).toBe(2);
    expect(t.status).toBe('stopped');
    expect(t.hasReachedQuorum).toBe(false);
  });

  it('reaches quorum only with no blocks', () => {
    const ok: Proposal = { ...baseProposal, participants: ['a', 'b', 'c', 'd', 'e'] };
    expect(tallyVotes(ok, 5).hasReachedQuorum).toBe(true);

    const blocked: Proposal = { ...ok, stoppers: ['x'] };
    expect(tallyVotes(blocked, 5).hasReachedQuorum).toBe(false);
  });

  it('preserves completed status', () => {
    const done: Proposal = { ...baseProposal, status: 'completed', participants: ['a'] };
    expect(tallyVotes(done).status).toBe('completed');
  });
});

describe('applyVote', () => {
  it('toggles agree votes', () => {
    const v1 = applyVote(baseProposal, 'alice', 'agree');
    expect(hasAgreed(v1, 'alice')).toBe(true);

    const v2 = applyVote(v1, 'alice', 'agree');
    expect(hasAgreed(v2, 'alice')).toBe(false);
  });

  it('switching from agree to block clears the agree', () => {
    const v1 = applyVote(baseProposal, 'alice', 'agree');
    const v2 = applyVote(v1, 'alice', 'block');
    expect(hasAgreed(v2, 'alice')).toBe(false);
    expect(hasBlocked(v2, 'alice')).toBe(true);
    expect(deriveStatus(v2)).toBe('stopped');
  });

  it('switching from block to agree clears the block', () => {
    const v1 = applyVote(baseProposal, 'alice', 'block');
    const v2 = applyVote(v1, 'alice', 'agree');
    expect(hasBlocked(v2, 'alice')).toBe(false);
    expect(hasAgreed(v2, 'alice')).toBe(true);
    expect(deriveStatus(v2)).toBe('ongoing');
  });

  it('matches voters by id across string/object/number forms', () => {
    const tgUser = { id: 42, first_name: 'Bob' };
    const v1 = applyVote(baseProposal, tgUser, 'agree');
    expect(hasAgreed(v1, { id: 42 })).toBe(true);
    expect(hasAgreed(v1, '42')).toBe(true); // loose match
    expect(hasAgreed(v1, 42)).toBe(true);
  });

  it('does not mutate the input proposal', () => {
    const v1 = applyVote(baseProposal, 'alice', 'agree');
    expect(baseProposal.participants).toEqual([]);
    expect(v1).not.toBe(baseProposal);
  });

  it('rejects voters without an id', () => {
    expect(() => applyVote(baseProposal, { first_name: 'noid' } as never, 'agree')).toThrow();
  });
});
