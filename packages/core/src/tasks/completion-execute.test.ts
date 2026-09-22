// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { executeCompletionPlan } from './completion-execute.js';
import { planTaskCompletion } from './completion-plan.js';
import { saveTaskToHolon, saveTasksToHolon } from './persistence.js';
import { DEFAULT_EQUATION } from '../scoring/index.js';
import type { Quest } from './types.js';

function fakeStore() {
  const puts: Array<{ holon: string; lens: string; id: unknown }> = [];
  return {
    puts,
    store: {
      put: async (holon: string, lens: string, value: any) => {
        puts.push({ holon, lens, id: value?.id });
      },
    },
    events: { put: async () => undefined },
  };
}

const dinner: Quest = {
  id: 'e1',
  title: 'Full moon dinner',
  type: 'event',
  status: 'completed',
  participants: [{ id: 'bob' }],
  timeTracking: { bob: 2 },
};

describe('where a completed record is saved', () => {
  it('goes back to the lens it came from, never a copy in quests', async () => {
    const { puts, store, events } = fakeStore();
    const plan = planTaskCompletion(dinner, DEFAULT_EQUATION, { holonId: 'h1' });
    const out = await executeCompletionPlan(store, events, 'h1', plan, { lens: 'events' });
    expect(out.taskSaved).toBe(true);
    expect(puts.filter((p) => p.id === 'e1')).toEqual([{ holon: 'h1', lens: 'events', id: 'e1' }]);
    // The hour expenses are their own lens whatever the record's is.
    expect(puts.filter((p) => p.id !== 'e1').map((p) => p.lens)).toEqual(['expenses']);
  });

  it('defaults to quests', async () => {
    const { puts, store, events } = fakeStore();
    const plan = planTaskCompletion({ ...dinner, type: 'task' }, DEFAULT_EQUATION);
    await executeCompletionPlan(store, events, 'h1', plan);
    expect(puts[0].lens).toBe('quests');
  });

  it('saveTaskToHolon / saveTasksToHolon take the lens too', async () => {
    const { puts, store } = fakeStore();
    await saveTaskToHolon(store, 'h1', dinner, 'events');
    await saveTasksToHolon(store, 'h1', [dinner], 'events');
    await saveTaskToHolon(store, 'h1', dinner);
    expect(puts.map((p) => p.lens)).toEqual(['events', 'events', 'quests']);
  });
});
