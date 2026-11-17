// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// quest_* over a real in-memory holosphere: propose, join, pledge, see it
// assemble, close.
import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { createHoloSphere } from '@holons/core/holosphere';
import { registerQuestsTools } from './quests.js';
import type { ToolDeps } from './index.js';

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>;

async function setup() {
  const hs: any = createHoloSphere({ appName: 'mcp-quests-test', privateKey: crypto.getRandomValues(new Uint8Array(32)), store: { adapter: 'memory' } });
  await hs.ready();
  const tools = new Map<string, Handler>();
  const server = { registerTool: (name: string, _def: { inputSchema: Record<string, ZodTypeAny> }, handler: Handler) => tools.set(name, handler) };
  registerQuestsTools(server as never, { getHoloSphere: async () => hs, resolveActor: () => ({ id: '7' }) as never } as ToolDeps);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await tools.get(name)!(args);
    return { ...JSON.parse(r.content[0].text), failed: !!r.isError };
  };
  return { call };
}

describe('quest tools', () => {
  it('proposes, joins, pledges, assembles and closes', async () => {
    const { call } = await setup();
    const until = Date.now() + 86_400_000;
    const made = await call('quest_propose', { board: 'pot', title: 'Open space', until, needs: [{ label: 'Hosts', quantity: 1, unit: 'people' }, { label: 'Room', quantity: 1 }] });
    expect(made).toMatchObject({ failed: false, success: true });

    expect((await call('quest_join', { board: 'pot', quest: made.id })).failed).toBe(false);
    expect((await call('quest_pledge', { board: 'pot', quest: made.id, need: 'n1', quantity: 1 })).error).toMatch(/headcount/);
    expect((await call('quest_pledge', { board: 'pot', quest: made.id, need: 'n2', quantity: 1, note: 'the barn' })).failed).toBe(false);

    const listed = await call('quest_board_list', { board: 'pot', state: 'assembled' });
    expect(listed.quests).toHaveLength(1);
    expect(listed.quests[0]).toMatchObject({ id: made.id, proposer: '7', coverage: 1 });

    await call('quest_add_need', { board: 'pot', quest: made.id, label: 'Snacks', quantity: 3 });
    expect((await call('quest_board_list', { board: 'pot' })).quests[0].needs).toHaveLength(3);

    expect((await call('quest_close', { board: 'pot', quest: made.id, outcome: 'done' })).failed).toBe(false);
    expect((await call('quest_board_list', { board: 'pot' })).quests[0].state).toBe('done');
  });

  it('says why a pledge without a need fails', async () => {
    const { call } = await setup();
    const out = await call('quest_pledge', { board: 'pot', quest: 'x' });
    expect(out).toMatchObject({ failed: true, success: false });
  });
});
