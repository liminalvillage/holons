import { describe, it, expect } from 'vitest';
import {
  wouldCreateDependencyCycle,
  findDependencyCycle,
  isQuestSettled,
  unmetDependencies,
} from './dependencies.js';
import type { Quest } from './types.js';

// Minimal quest factory — only id + dependencies matter for these helpers.
function q(id: string, dependencies: string[] = []): Quest {
  return { id, title: id, status: 'ongoing', participants: [], dependencies };
}

// Same, but settled (already done) so it no longer blocks its successors.
function done(id: string, dependencies: string[] = []): Quest {
  return { ...q(id, dependencies), status: 'completed' };
}

describe('wouldCreateDependencyCycle', () => {
  it('flags a self-dependency', () => {
    expect(wouldCreateDependencyCycle([q('a')], 'a', 'a')).toBe(true);
  });

  it('flags an edge that closes a loop', () => {
    // b already depends on a; making a depend on b would form a → b → a.
    const quests = [q('a'), q('b', ['a'])];
    expect(wouldCreateDependencyCycle(quests, 'a', 'b')).toBe(true);
  });

  it('flags a transitive loop', () => {
    // c → b → a already; a depending on c closes a → c → b → a.
    const quests = [q('a'), q('b', ['a']), q('c', ['b'])];
    expect(wouldCreateDependencyCycle(quests, 'a', 'c')).toBe(true);
  });

  it('allows an edge that keeps the graph acyclic', () => {
    const quests = [q('a'), q('b', ['a']), q('c')];
    // a depending on c is fine (c has no path back to a).
    expect(wouldCreateDependencyCycle(quests, 'a', 'c')).toBe(false);
  });
});

describe('findDependencyCycle', () => {
  it('returns null for an acyclic graph', () => {
    const quests = [q('a'), q('b', ['a']), q('c', ['a', 'b'])];
    expect(findDependencyCycle(quests)).toBeNull();
  });

  it('returns the ids forming a cycle', () => {
    const quests = [q('a', ['c']), q('b', ['a']), q('c', ['b'])];
    const cycle = findDependencyCycle(quests);
    expect(cycle).not.toBeNull();
    expect(new Set(cycle)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('ignores dangling and self references', () => {
    const quests = [q('a', ['missing', 'a']), q('b', ['a'])];
    expect(findDependencyCycle(quests)).toBeNull();
  });
});

describe('isQuestSettled', () => {
  it('treats completed/cancelled/deleted quests as settled', () => {
    expect(isQuestSettled({ ...q('a'), status: 'completed' })).toBe(true);
    expect(isQuestSettled({ ...q('a'), status: 'cancelled' })).toBe(true);
    expect(isQuestSettled({ ...q('a'), completed: true })).toBe(true);
    expect(isQuestSettled({ ...q('a'), _deleted: true })).toBe(true);
  });

  it('tolerates legacy status casing', () => {
    expect(isQuestSettled({ ...q('a'), status: 'Completed' })).toBe(true);
  });

  it('leaves open and stopped quests unsettled', () => {
    expect(isQuestSettled(q('a'))).toBe(false);
    expect(isQuestSettled({ ...q('a'), status: 'stopped' })).toBe(false);
  });
});

describe('unmetDependencies', () => {
  it('marks self-standing quests as unblocked', () => {
    const unmet = unmetDependencies([q('a'), q('b')]);
    expect(unmet.get('a')).toEqual([]);
    expect(unmet.get('b')).toEqual([]);
  });

  it('lists only the still-open predecessors', () => {
    // c waits on a (done) and b (open) — only b still stands in the way.
    const unmet = unmetDependencies([done('a'), q('b'), q('c', ['a', 'b'])]);
    expect(unmet.get('b')).toEqual([]);
    expect(unmet.get('c')).toEqual(['b']);
  });

  it('unblocks a quest once every predecessor settles', () => {
    const unmet = unmetDependencies([done('a'), done('b'), q('c', ['a', 'b'])]);
    expect(unmet.get('c')).toEqual([]);
  });

  it('omits settled quests — they are not actionable themselves', () => {
    const unmet = unmetDependencies([done('a'), q('b', ['a'])]);
    expect(unmet.has('a')).toBe(false);
  });

  it('never blocks on dangling or self references', () => {
    const unmet = unmetDependencies([q('a', ['missing', 'a'])]);
    expect(unmet.get('a')).toEqual([]);
  });

  it('only direct predecessors block — a blocked dependency still blocks', () => {
    // c → b → a, all open: b waits on a, c waits on b (not on a).
    const unmet = unmetDependencies([q('a'), q('b', ['a']), q('c', ['b'])]);
    expect(unmet.get('b')).toEqual(['a']);
    expect(unmet.get('c')).toEqual(['b']);
  });
});
