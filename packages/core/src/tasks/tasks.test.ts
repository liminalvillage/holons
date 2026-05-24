// Unit tests for @holons/core/tasks. Pure functions only — persistence is
// tested with an in-memory HoloSphereLike mock.

import { describe, it, expect } from 'vitest';
import {
  createTaskFromStep,
  createDefaultTask,
  createTasksFromDesignStreams,
  createTasksFromQuestTree,
  createTask,
  COUNCIL_INITIATOR,
  DEFAULT_TASK_CATEGORY,
} from './creation.js';
import { saveTaskToHolon, saveTasksToHolon } from './persistence.js';
import type { QuestTree, RitualSession, HoloSphereLike } from './types.js';

const HOLON = 'h-1';

function streams(steps: string[][]): RitualSession['design_streams'] {
  return steps.map((stepList, i) => ({
    name: `S${i}`,
    description: `desc ${i}`,
    materials: [],
    steps: stepList,
  }));
}

describe('createTaskFromStep', () => {
  it('produces the council-initiator task shape with deterministic orderIndex', () => {
    const stream = streams([['do thing']])[0];
    const t = createTaskFromStep('do thing', stream, 2, 3, HOLON);
    expect(t.title).toBe('do thing');
    expect(t.status).toBe('pending');
    expect(t.type).toBe('task');
    expect(t.category).toBe(DEFAULT_TASK_CATEGORY);
    expect(t.orderIndex).toBe(2 * 100 + 3);
    expect(t.description).toBe('From S0: desc 0');
    expect(t.initiator).toMatchObject({ id: HOLON, ...COUNCIL_INITIATOR });
    expect(t.appreciation).toEqual([]);
    expect(t.participants).toEqual([]);
  });
});

describe('createDefaultTask', () => {
  it('emits the fallback task when no streams exist', () => {
    const t = createDefaultTask('my wish', HOLON);
    expect(t.title).toBe('Begin the journey');
    expect(t.description).toContain('my wish');
    expect(t.orderIndex).toBe(0);
    expect(t.status).toBe('pending');
  });
});

describe('createTasksFromDesignStreams', () => {
  it('flattens streams x steps preserving orderIndex', () => {
    const tasks = createTasksFromDesignStreams(
      streams([['a', 'b'], ['c']]),
      'wish',
      HOLON,
    );
    expect(tasks).toHaveLength(3);
    expect(tasks.map((t) => t.title)).toEqual(['a', 'b', 'c']);
    expect(tasks.map((t) => t.orderIndex)).toEqual([0, 1, 100]);
  });

  it('falls back to default task when no streams', () => {
    const tasks = createTasksFromDesignStreams([], 'wish', HOLON);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe('Begin the journey');
  });
});

describe('createTasksFromQuestTree', () => {
  it('builds tasks with parent->child dependsOn and rich descriptions', () => {
    const tree: QuestTree = {
      id: 'qt1',
      vision: { statement: 'v', principles: [], successIndicators: [] },
      nodes: {
        root: {
          id: 'root',
          title: 'Root',
          description: 'root desc',
          parentId: null,
          childIds: ['c1'],
          generation: 0,
          generationIndex: 0,
          status: 'pending',
          dependencies: [],
          skillsRequired: ['s1'],
          resourcesRequired: [],
          impactCategory: 'ecological',
          participants: [],
          assumptions: [],
          questions: [],
          actions: ['act1'],
          created: '',
          createdBy: '',
          lastModified: '',
        },
        c1: {
          id: 'c1',
          title: 'Child',
          parentId: 'root',
          childIds: [],
          generation: 1,
          generationIndex: 0,
          status: 'pending',
          dependencies: [],
          skillsRequired: [],
          resourcesRequired: [],
          impactCategory: 'social',
          participants: [],
          assumptions: [],
          questions: [],
          actions: [],
          created: '',
          createdBy: '',
          lastModified: '',
        },
      },
      rootNodeIds: ['root'],
      maxGenerations: 6,
      branchingFactor: 3,
      impactDimensions: [],
      created: '',
      createdBy: '',
      lastModified: '',
      headAdvisor: '',
    };
    const tasks = createTasksFromQuestTree(tree, HOLON);
    const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
    const root = byId['qt-qt1-root']!;
    const child = byId['qt-qt1-c1']!;
    expect(root.dependsOn).toEqual(['qt-qt1-c1']);
    expect(child.dependsOn).toBeUndefined();
    expect(root.orderIndex).toBe(0);
    expect(child.orderIndex).toBe(100);
    expect(root.description).toContain('root desc');
    expect(root.description).toContain('🔧 Skills: s1');
    expect(root.description).toContain('⚡ Actions: act1');
    expect(root._meta?.source).toBe('quest_tree');
    expect(root._meta?.questTreeId).toBe('qt1');
  });
});

describe('createTask', () => {
  it('produces the bot-style default-field set', () => {
    const q = createTask({
      holonId: 42,
      initiator: { id: 7, username: 'alice' },
      title: 'Write tests',
      type: 'task',
      category: 'general',
      now: 1_000,
    });
    expect(q.id).toBe('');
    expect(q.title).toBe('Write tests');
    expect(q.holon).toBe(42);
    expect(q.status).toBe('ongoing');
    expect(q.type).toBe('task');
    // Canonical creation timestamp is the ISO form of `now`.
    expect(q.created).toBe(new Date(1_000).toISOString());
    expect(q.participants).toEqual([]);
    expect(q.appreciation).toEqual([]);
    expect(q.stoppers).toEqual([]);
    expect(q.dependencies).toEqual([]);
    expect(q.frequency).toBeNull();
    expect(q.recurringTaskId).toBeNull();
    expect(q.timeTracking).toEqual({});
    expect(q.checklistId).toBeNull();
    expect(q.reminderId).toBeNull();
    expect(q.activeHolograms).toEqual([]);
    expect(q.where).toEqual({ latitude: '', longitude: '' });
    expect(q.message_thread_id).toBeNull();
    expect(q.picture).toBeNull();
    expect(q.version).toBe('0.1');
  });
});

describe('persistence', () => {
  function makeHs(): HoloSphereLike & { writes: any[] } {
    const writes: any[] = [];
    return {
      writes,
      async put(holonId, bucket, value) {
        writes.push({ holonId, bucket, value });
      },
    };
  }

  it('saveTaskToHolon returns true on success', async () => {
    const hs = makeHs();
    const ok = await saveTaskToHolon(hs, HOLON, { title: 't', participants: [], status: 'pending' });
    expect(ok).toBe(true);
    expect(hs.writes).toHaveLength(1);
    expect(hs.writes[0].bucket).toBe('quests');
  });

  it('saveTaskToHolon returns false and swallows errors', async () => {
    const hs: HoloSphereLike = {
      async put() {
        throw new Error('boom');
      },
    };
    const ok = await saveTaskToHolon(hs, HOLON, { title: 't', participants: [], status: 'pending' });
    expect(ok).toBe(false);
  });

  it('saveTasksToHolon counts successes only', async () => {
    let n = 0;
    const hs: HoloSphereLike = {
      async put() {
        n++;
        if (n === 2) throw new Error('mid-failure');
      },
    };
    const tasks = [
      { title: 'a', participants: [], status: 'pending' },
      { title: 'b', participants: [], status: 'pending' },
      { title: 'c', participants: [], status: 'pending' },
    ];
    const count = await saveTasksToHolon(hs, HOLON, tasks);
    expect(count).toBe(2);
  });
});
