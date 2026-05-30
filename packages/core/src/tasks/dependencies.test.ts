import { describe, it, expect } from 'vitest';
import {
  wouldCreateDependencyCycle,
  findDependencyCycle,
} from './dependencies.js';
import type { Quest } from './types.js';

// Minimal quest factory — only id + dependencies matter for these helpers.
function q(id: string, dependencies: string[] = []): Quest {
  return { id, title: id, status: 'ongoing', participants: [], dependencies };
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
