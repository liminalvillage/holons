// SPDX-License-Identifier: AGPL-3.0-or-later
//
// calendar_event_create writes a quest of type 'event' to the `quests` lens —
// the one lens every calendar surface reads — in the same shape a kiosk- or
// bot-made event has, with hosts folded in by core.
import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { registerCalendarTools } from './calendar.js';
import type { ToolDeps } from './index.js';

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>;

function capture() {
  const tools = new Map<string, Handler>();
  const server = {
    tool: (name: string, _desc: string, _schema: Record<string, ZodTypeAny>, handler: Handler) => {
      tools.set(name, handler);
    },
    registerTool: (name: string, _def: { inputSchema: Record<string, ZodTypeAny> }, handler: Handler) => {
      tools.set(name, handler);
    },
  };
  return { server: server as never, tools };
}

function fakeDeps() {
  const db: Record<string, Record<string, Record<string, unknown>>> = {};
  const hs = {
    get: async (holon: string, lens: string, key?: string) => (key ? (db[`${holon}/${lens}`]?.[key] ?? null) : null),
    getAll: async (holon: string, lens: string) => Object.values(db[`${holon}/${lens}`] ?? {}),
    put: async (holon: string, lens: string, rec: { id?: string | number }) => {
      (db[`${holon}/${lens}`] ??= {})[String(rec.id)] = rec;
      return true;
    },
  };
  const deps: ToolDeps = {
    getHoloSphere: async () => hs,
    resolveActor: () => ({ id: '7', username: 'ada', first_name: 'Ada' }) as never,
  };
  return { deps, db };
}

const payload = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);

function setup() {
  const { server, tools } = capture();
  const { deps, db } = fakeDeps();
  registerCalendarTools(server, deps);
  return { create: tools.get('calendar_event_create')!, db };
}

describe('calendar_event_create', () => {
  it('lands in the quests lens as an event with the end in `ends`', async () => {
    const { create, db } = setup();
    const out = payload(
      await create({
        holon: 'h1',
        title: 'Coordination meeting',
        when: '2026-09-26T08:00:00.000Z',
        until: '2026-09-26T10:30:00.000Z',
        description: 'weekly',
        category: 'Quests & Scheduling',
        id: 'ev1',
      }),
    );
    expect(out.success).toBe(true);
    expect(out.lens).toBe('quests');
    expect(db['h1/events']).toBeUndefined();
    const stored = db['h1/quests'].ev1;
    expect(stored).toMatchObject({
      id: 'ev1',
      holon: 'h1',
      type: 'event',
      status: 'ongoing',
      title: 'Coordination meeting',
      description: 'weekly',
      category: 'Quests & Scheduling',
      when: '2026-09-26T08:00:00.000Z',
      ends: '2026-09-26T10:30:00.000Z',
      until: '',
      participants: [],
      appreciation: [],
      initiator: { id: '7', username: 'ada', firstName: 'Ada' },
    });
    expect(stored.hosts).toBeUndefined();
    expect(typeof stored.created).toBe('string');
  });

  it('generates a short underscore-free id when none is given', async () => {
    const { create } = setup();
    const out = payload(await create({ holon: 'h1', title: 'Yoga', when: '2026-09-23T06:30:00.000Z' }));
    expect(out.event.id).toMatch(/^[a-z0-9]+$/);
    expect(out.event.ends).toBe('');
  });

  it('folds hosts in through core, one entry per person', async () => {
    const { create, db } = setup();
    await create({
      holon: 'h1',
      title: 'Happy Money Story',
      when: '2026-09-24T08:00:00.000Z',
      id: 'ev2',
      hosts: [
        { id: 15, username: 'alex', first_name: 'Alex' },
        { id: '15', username: 'alex' },
        { id: 99 },
      ],
    });
    expect(db['h1/quests'].ev2.hosts).toEqual([
      { id: '15', username: 'alex', firstName: 'Alex' },
      { id: '99' },
    ]);
  });

  it('drops an end that is not after the start', async () => {
    const { create } = setup();
    const out = payload(
      await create({ holon: 'h1', title: 'Backwards', when: '2026-09-24T10:00:00.000Z', until: '2026-09-24T09:00:00.000Z' }),
    );
    expect(out.success).toBe(true);
    expect(out.event.ends).toBe('');
  });

  it('refuses an unparsable start', async () => {
    const { create, db } = setup();
    const res = await create({ holon: 'h1', title: 'Nope', when: 'next tuesday' });
    expect(res.isError).toBe(true);
    expect(db['h1/quests']).toBeUndefined();
  });
});
