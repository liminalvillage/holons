// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, it, expect } from 'vitest';
import {
  BREAKDOWN_MAX_CONTEXT_TASKS,
  BREAKDOWN_MAX_DESCRIPTION_CHARS,
  BREAKDOWN_MAX_GOAL_DESCRIPTION_CHARS,
  BreakdownValidationError,
  applyBreakdownProposal,
  buildBreakdownPrompt,
  parseBreakdownProposal,
  toBreakdownContext,
  type BreakdownProposal,
  type BreakdownStep,
} from './breakdown.js';
import type { Quest } from './types.js';

function q(id: string, extra: Partial<Quest> = {}): Quest {
  return { id, title: `task ${id}`, status: 'ongoing', participants: [], ...extra };
}

function step(title: string, extra: Partial<BreakdownStep> = {}): BreakdownStep {
  return {
    title,
    description: `${title} done`,
    existingTaskId: '',
    dependsOnSteps: [],
    dependsOnExisting: [],
    ...extra,
  };
}

function proposal(steps: BreakdownStep[], atomic = false): BreakdownProposal {
  return { atomic, reasoning: 'because', steps };
}

const seqId = () => {
  let n = 0;
  return () => `new${++n}`;
};

describe('toBreakdownContext', () => {
  it('compacts, skips deleted/id-less records, and truncates descriptions', () => {
    const quests = [
      q('a', { description: 'x'.repeat(500), dependencies: ['b'] }),
      q('b', { _deleted: true }),
      { title: 'no id', status: 'ongoing', participants: [] } as Quest,
    ];
    const ctx = toBreakdownContext(quests);
    expect(ctx).toHaveLength(1);
    expect(ctx[0].id).toBe('a');
    expect(ctx[0].description!.length).toBe(BREAKDOWN_MAX_DESCRIPTION_CHARS);
    expect(ctx[0].dependencies).toEqual(['b']);
  });

  it('honours a larger description budget for the goal task', () => {
    const quests = [q('goal', { description: 'y'.repeat(5000) })];
    const ctx = toBreakdownContext(quests, {
      maxDescriptionChars: BREAKDOWN_MAX_GOAL_DESCRIPTION_CHARS,
    });
    expect(ctx[0].description!.length).toBe(BREAKDOWN_MAX_GOAL_DESCRIPTION_CHARS);
    expect(BREAKDOWN_MAX_GOAL_DESCRIPTION_CHARS).toBeGreaterThan(
      BREAKDOWN_MAX_DESCRIPTION_CHARS,
    );
  });

  it('caps the task count, preferring active tasks over settled ones', () => {
    const quests: Quest[] = [];
    for (let i = 0; i < BREAKDOWN_MAX_CONTEXT_TASKS; i++) {
      quests.push(q(`done${i}`, { status: 'completed' }));
    }
    quests.push(q('live'));
    const ctx = toBreakdownContext(quests);
    expect(ctx).toHaveLength(BREAKDOWN_MAX_CONTEXT_TASKS);
    expect(ctx[0].id).toBe('live');
  });
});

describe('buildBreakdownPrompt', () => {
  it('includes the target task, the canvas, and the no-duplication rule', () => {
    const ctx = toBreakdownContext([q('a'), q('b')]);
    const { system, user } = buildBreakdownPrompt({
      task: ctx[0],
      allTasks: ctx,
      holonContext: 'Community garden',
    });
    expect(system).toContain('NEVER recreate');
    expect(system).toContain('INDEPENDENT, PARALLEL');
    expect(system).toContain('achieved state');
    expect(system).toContain('atomic');
    expect(user).toContain('Community garden');
    expect(user).toContain('"id":"a"');
    expect(user).toContain('"id":"b"');
  });
});

describe('parseBreakdownProposal', () => {
  it('accepts a valid proposal and trims strings', () => {
    const p = parseBreakdownProposal({
      atomic: false,
      reasoning: 'r',
      steps: [
        {
          title: '  Dig bed  ',
          description: 'd',
          existingTaskId: '',
          dependsOnSteps: [0],
          dependsOnExisting: ['x'],
        },
      ],
    });
    expect(p.steps[0].title).toBe('Dig bed');
  });

  it('rejects malformed shapes', () => {
    expect(() => parseBreakdownProposal(null)).toThrow(BreakdownValidationError);
    expect(() => parseBreakdownProposal({ atomic: 'yes', reasoning: '', steps: [] })).toThrow(
      BreakdownValidationError,
    );
    expect(() =>
      parseBreakdownProposal({
        atomic: false,
        reasoning: '',
        steps: [{ title: '', description: '', existingTaskId: '', dependsOnSteps: [], dependsOnExisting: [] }],
      }),
    ).toThrow(/title/);
    expect(() =>
      parseBreakdownProposal({
        atomic: false,
        reasoning: '',
        steps: [{ title: 't', description: '', existingTaskId: '', dependsOnSteps: [1.5], dependsOnExisting: [] }],
      }),
    ).toThrow(/integers/);
  });

  it('rejects an atomic proposal that still has steps', () => {
    expect(() =>
      parseBreakdownProposal({ atomic: true, reasoning: '', steps: [step('a')] }),
    ).toThrow(/atomic/);
  });
});

describe('applyBreakdownProposal', () => {
  it('returns nothing for an atomic proposal', () => {
    const parent = q('p', { dependencies: ['old'] });
    const res = applyBreakdownProposal({
      proposal: proposal([], true),
      parent,
      allQuests: [parent, q('old')],
    });
    expect(res.newQuests).toEqual([]);
    expect(res.parentDependencies).toEqual(['old']);
  });

  it('wires a chain A→B→C so the parent depends only on the last step', () => {
    const parent = q('p');
    const res = applyBreakdownProposal({
      proposal: proposal([
        step('A'),
        step('B', { dependsOnSteps: [0] }),
        step('C', { dependsOnSteps: [1] }),
      ]),
      parent,
      allQuests: [parent],
      generateId: seqId(),
    });
    expect(res.newQuests.map((t) => t.id)).toEqual(['new1', 'new2', 'new3']);
    expect(res.newQuests[1].dependencies).toEqual(['new1']);
    expect(res.newQuests[2].dependencies).toEqual(['new2']);
    expect(res.parentDependencies).toEqual(['new3']);
    expect(res.warnings).toEqual([]);
  });

  it('makes the parent depend on every sink of parallel branches', () => {
    const parent = q('p', { dependencies: ['old'] });
    const res = applyBreakdownProposal({
      proposal: proposal([
        step('shared root'),
        step('branch 1', { dependsOnSteps: [0] }),
        step('branch 2', { dependsOnSteps: [0] }),
      ]),
      parent,
      allQuests: [parent, q('old')],
      generateId: seqId(),
    });
    expect(res.parentDependencies).toEqual(['old', 'new2', 'new3']);
  });

  it('reuses an existing task instead of duplicating it', () => {
    const parent = q('p');
    const existing = q('e');
    const res = applyBreakdownProposal({
      proposal: proposal([
        step('reuse e', { existingTaskId: 'e' }),
        step('new work', { dependsOnSteps: [0] }),
      ]),
      parent,
      allQuests: [parent, existing],
      generateId: seqId(),
    });
    expect(res.newQuests).toHaveLength(1);
    expect(res.newQuests[0].dependencies).toEqual(['e']);
    expect(res.reusedExistingIds).toEqual(['e']);
    expect(res.parentDependencies).toEqual(['new1']);
  });

  it('drops invalid references with warnings instead of failing', () => {
    const parent = q('p');
    const res = applyBreakdownProposal({
      proposal: proposal([
        step('bad refs', {
          dependsOnSteps: [5, 0],
          dependsOnExisting: ['ghost', 'p'],
          existingTaskId: 'ghost2',
        }),
      ]),
      parent,
      allQuests: [parent],
      generateId: seqId(),
    });
    expect(res.newQuests).toHaveLength(1);
    expect(res.newQuests[0].dependencies).toEqual([]);
    expect(res.warnings.length).toBeGreaterThanOrEqual(4);
  });

  it('breaks ordering loops between steps', () => {
    const parent = q('p');
    const res = applyBreakdownProposal({
      proposal: proposal([
        step('A', { dependsOnSteps: [1] }),
        step('B', { dependsOnSteps: [0] }),
      ]),
      parent,
      allQuests: [parent],
      generateId: seqId(),
    });
    // First edge (A depends on B) survives; the back-edge is dropped.
    expect(res.newQuests[0].dependencies).toEqual(['new2']);
    expect(res.newQuests[1].dependencies).toEqual([]);
    expect(res.warnings.some((w) => w.includes('loop'))).toBe(true);
    expect(res.parentDependencies).toEqual(['new1']);
  });

  it('repairs a cycle introduced through an existing task', () => {
    // e already depends on the parent; a step depending on e would close
    // parent → step → e → parent.
    const parent = q('p');
    const e = q('e', { dependencies: ['p'] });
    const res = applyBreakdownProposal({
      proposal: proposal([step('S', { dependsOnExisting: ['e'] })]),
      parent,
      allQuests: [parent, e],
      generateId: seqId(),
    });
    expect(res.newQuests[0].dependencies).toEqual([]);
    expect(res.parentDependencies).toEqual(['new1']);
    expect(res.warnings.some((w) => w.includes('cycle'))).toBe(true);
  });

  it('repairs a cycle from reusing a task that depends on the parent', () => {
    const parent = q('p');
    const e = q('e', { dependencies: ['p'] });
    const res = applyBreakdownProposal({
      proposal: proposal([step('reuse e', { existingTaskId: 'e' })]),
      parent,
      allQuests: [parent, e],
      generateId: seqId(),
    });
    expect(res.newQuests).toEqual([]);
    expect(res.parentDependencies).toEqual([]);
    expect(res.warnings.some((w) => w.includes('cycle'))).toBe(true);
  });

  it('assigns increasing orderIndex after the existing maximum', () => {
    const parent = q('p', { orderIndex: 3 });
    const res = applyBreakdownProposal({
      proposal: proposal([step('A'), step('B')]),
      parent,
      allQuests: [parent, q('x', { orderIndex: 7 })],
      generateId: seqId(),
    });
    expect(res.newQuests.map((t) => t.orderIndex)).toEqual([8, 9]);
  });

  it('places steps left of the parent, layered by dependency depth', () => {
    const parent = q('p', { position: { x: 1000, y: 500 } });
    const res = applyBreakdownProposal({
      proposal: proposal([
        step('early'),
        step('late', { dependsOnSteps: [0] }),
      ]),
      parent,
      allQuests: [parent],
      generateId: seqId(),
    });
    const [early, late] = res.newQuests;
    expect(early.position).toEqual({ x: 1000 - 2 * 520, y: 500 });
    expect(late.position).toEqual({ x: 1000 - 520, y: 500 });
  });

  it('stacks same-layer steps vertically around the parent', () => {
    const parent = q('p', { position: { x: 0, y: 0 } });
    const res = applyBreakdownProposal({
      proposal: proposal([step('A'), step('B')]),
      parent,
      allQuests: [parent],
      generateId: seqId(),
    });
    expect(res.newQuests[0].position).toEqual({ x: -520, y: -190 });
    expect(res.newQuests[1].position).toEqual({ x: -520, y: 190 });
  });

  it('leaves position unset when the parent has none', () => {
    const parent = q('p');
    const res = applyBreakdownProposal({
      proposal: proposal([step('A')]),
      parent,
      allQuests: [parent],
      generateId: seqId(),
    });
    expect(res.newQuests[0].position).toBeUndefined();
  });

  it('avoids id collisions from an injected generator', () => {
    const parent = q('p');
    const res = applyBreakdownProposal({
      proposal: proposal([step('A'), step('B')]),
      parent,
      allQuests: [parent],
      generateId: () => 'same',
    });
    const ids = res.newQuests.map((t) => String(t.id));
    expect(new Set(ids).size).toBe(2);
  });

  it('inherits holon, category and initiator from the parent', () => {
    const parent = q('p', {
      holon: 'h1',
      category: 'garden',
      initiator: { id: 42, username: 'rob' },
    });
    const res = applyBreakdownProposal({
      proposal: proposal([step('A')]),
      parent,
      allQuests: [parent],
      generateId: seqId(),
      now: 1_000_000,
    });
    const t = res.newQuests[0];
    expect(t.holon).toBe('h1');
    expect(t.category).toBe('garden');
    expect(t.initiator).toEqual({ id: 42, username: 'rob' });
    expect(t.created).toBe(new Date(1_000_000).toISOString());
    expect(t.status).toBe('ongoing');
  });

  it('warns above the soft step cap without failing', () => {
    const parent = q('p');
    const res = applyBreakdownProposal({
      proposal: proposal(Array.from({ length: 11 }, (_, i) => step(`S${i}`))),
      parent,
      allQuests: [parent],
      generateId: seqId(),
    });
    expect(res.newQuests).toHaveLength(11);
    expect(res.warnings.some((w) => w.includes('11 steps'))).toBe(true);
  });
});
