import { describe, it, expect } from 'vitest';
import {
  wouldCreateDependencyCycle,
  findDependencyCycle,
  isQuestSettled,
  unmetDependencies,
  moveDependency,
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

describe('moveDependency', () => {
  const deps = (r: ReturnType<typeof moveDependency>, id: string) =>
    r.ok ? r.edits.find((e) => e.id === id)?.dependencies : undefined;

  it('moves the card from its old dependent to the target', () => {
    // p waits on a; dropping a on b: b waits on a, p no longer does.
    const quests = [q('a'), q('p', ['a']), q('b')];
    const r = moveDependency(quests, 'a', 'b');
    expect(r.ok).toBe(true);
    expect(deps(r, 'b')).toEqual(['a']);
    expect(deps(r, 'p')).toEqual([]);
    expect(r.ok && r.edits.map((e) => e.id)).toEqual(['b', 'p']); // target first
  });

  it('clears EVERY old dependent, not just one', () => {
    const quests = [q('a'), q('p', ['a']), q('r', ['x', 'a']), q('x'), q('b')];
    const r = moveDependency(quests, 'a', 'b');
    expect(deps(r, 'p')).toEqual([]);
    expect(deps(r, 'r')).toEqual(['x']);
    expect(deps(r, 'b')).toEqual(['a']);
  });

  it('appends last and keeps the target\'s existing order', () => {
    const quests = [q('a'), q('x'), q('y'), q('b', ['y', 'x'])];
    expect(deps(moveDependency(quests, 'a', 'b'), 'b')).toEqual(['y', 'x', 'a']);
  });

  it('only prunes when the target already lists the card and others do too', () => {
    const quests = [q('a'), q('b', ['a']), q('p', ['a'])];
    const r = moveDependency(quests, 'a', 'b');
    expect(r.ok && r.edits.map((e) => e.id)).toEqual(['p']); // no duplicate on b
    expect(deps(r, 'p')).toEqual([]);
  });

  it('has nothing to write when the target is already the only dependent', () => {
    const r = moveDependency([q('a'), q('b', ['a'])], 'a', 'b');
    expect(r).toEqual({ ok: true, edits: [] });
  });

  it('lets a transitive predecessor become a direct one, pruning the middle', () => {
    // a → x → b; dropping a on b: b waits on a AND x, x no longer waits on a.
    const quests = [q('a'), q('x', ['a']), q('b', ['x'])];
    const r = moveDependency(quests, 'a', 'b');
    expect(r.ok).toBe(true);
    expect(deps(r, 'b')).toEqual(['x', 'a']);
    expect(deps(r, 'x')).toEqual([]);
  });

  it('refuses self, unknown ids and loops', () => {
    const quests = [q('a'), q('b', ['a']), q('c', ['b'])];
    expect(moveDependency(quests, 'a', 'a')).toEqual({ ok: false, reason: 'self' });
    expect(moveDependency(quests, 'ghost', 'a')).toEqual({ ok: false, reason: 'unknown' });
    expect(moveDependency(quests, 'a', 'ghost')).toEqual({ ok: false, reason: 'unknown' });
    // a waits on nothing; making a wait on b closes a → b → a.
    expect(moveDependency(quests, 'b', 'a')).toEqual({ ok: false, reason: 'cycle' });
    // ...and transitively: c → b → a, so a waiting on c loops too.
    expect(moveDependency(quests, 'c', 'a')).toEqual({ ok: false, reason: 'cycle' });
  });

  it('coerces numeric ids and tolerates missing dependencies', () => {
    const quests: Quest[] = [
      { id: 1 as unknown as string, title: 'one', status: 'ongoing', participants: [] },
      { id: 2 as unknown as string, title: 'two', status: 'ongoing', participants: [], dependencies: [1 as unknown as string] },
      { id: 3 as unknown as string, title: 'three', status: 'ongoing', participants: [] },
    ];
    const r = moveDependency(quests, '1', '3');
    expect(r.ok).toBe(true);
    expect(r.ok && r.edits.map((e) => [e.id, e.dependencies])).toEqual([
      [3, ['1']],
      [2, []],
    ]);
  });

  it('never mutates its input', () => {
    const quests = [q('a'), q('p', ['a']), q('b', ['x']), q('x')];
    const snapshot = JSON.stringify(quests);
    moveDependency(quests, 'a', 'b');
    expect(JSON.stringify(quests)).toBe(snapshot);
  });
});
