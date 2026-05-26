// Unit tests for @holons/core/tasks. Pure functions only — persistence is
// tested with an in-memory HoloSphereLike mock.

import { describe, it, expect } from 'vitest';
import { createTask } from './creation.js';
import { saveTaskToHolon, saveTasksToHolon } from './persistence.js';
import type { HoloSphereLike } from './types.js';

const HOLON = 'h-1';

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
