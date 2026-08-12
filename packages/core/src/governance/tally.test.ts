// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { computeVoteWeights, tallyProposal, voteWeightOf } from './tally.js';

const proposal = (voters: string[]) => ({
  id: 'prop-1',
  type: 'proposal',
  title: 'buy a shared drill',
  participants: voters.map((id) => ({ id })),
});

describe('voteWeightOf', () => {
  it('everyone counts for 1; reputation adds the stars they have earned', () => {
    expect(voteWeightOf(undefined)).toBe(1);
    expect(voteWeightOf({ count: 0, average: 0 })).toBe(1);
    expect(voteWeightOf({ count: 2, average: 4 })).toBe(9); // 1 + 8 stars
  });

  it('computeVoteWeights maps a member list through the reputation fold', () => {
    const weights = computeVoteWeights(['a', 'b'], {
      a: { count: 1, average: 5 },
    });
    expect(weights).toEqual({ a: 6, b: 1 });
  });
});

describe('tallyProposal', () => {
  const reputation = {
    alice: { count: 2, average: 5 }, // weight 11
    bob: { count: 1, average: 3 }, // weight 4
    // carol, dave: no ratings → weight 1
  };
  const members = ['alice', 'bob', 'carol', 'dave']; // total weight 17

  it('weights direct votes by reputation', () => {
    const t = tallyProposal(proposal(['alice']), members, { reputation });
    expect(t.total).toBe(17);
    expect(t.yes).toBe(11);
    expect(t.direct).toBe(11);
    expect(t.delegated).toBe(0);
    expect(t.passed).toBe(true); // 11/17 > 0.5
  });

  it('routes a non-voter weight through their delegation chain', () => {
    const t = tallyProposal(proposal(['bob']), members, {
      reputation,
      delegations: { carol: 'dave', dave: 'bob' }, // both land on bob
    });
    expect(t.yes).toBe(6); // bob 4 + carol 1 + dave 1
    expect(t.delegated).toBe(2);
    expect(t.passed).toBe(false); // 6/17
  });

  it('a direct vote outranks one own delegation (no double count)', () => {
    const t = tallyProposal(proposal(['alice', 'carol']), members, {
      reputation,
      delegations: { carol: 'alice' },
    });
    expect(t.yes).toBe(12); // alice 11 + carol 1, carol counted once, directly
    expect(t.direct).toBe(12);
    expect(t.delegated).toBe(0);
  });

  it('counts voters missing from the member list and survives empty holons', () => {
    const t = tallyProposal(proposal(['zoe']), ['alice'], { reputation });
    expect(t.total).toBe(12); // alice 11 + zoe 1
    expect(t.yes).toBe(1);
    const empty = tallyProposal(proposal([]), [], {});
    expect(empty.total).toBe(0);
    expect(empty.passed).toBe(false);
  });

  it('honours a custom threshold, strictly', () => {
    const half = tallyProposal(proposal(['bob', 'carol', 'dave', 'zoe']), members, {
      reputation,
    }); // yes 6+? bob4+carol1+dave1+zoe1=7, total 17+1=18
    expect(half.yes).toBe(7);
    expect(half.total).toBe(18);
    expect(half.passed).toBe(false);
    const lenient = tallyProposal(proposal(['bob']), ['bob', 'carol'], {
      reputation,
      threshold: 0.5,
    }); // 4/5 > 0.5
    expect(lenient.passed).toBe(true);
    const exact = tallyProposal(proposal(['carol']), ['carol', 'dave'], {}); // 1/2 NOT > 0.5
    expect(exact.passed).toBe(false);
  });
});
