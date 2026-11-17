// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Thin MCP wrappers around the quest board in @holons/core/tasks — quests
// that need resourcing before they can happen, on the open `quest_board`
// log of a board holon (the Pot, or an event's holon). The acting party is
// the resolved actor. See docs/quests-board.md.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { addQuestNeed, closeQuest, joinQuest, leaveQuest, loadQuestBoard, pledgeToQuest, proposeQuest, withdrawPledge } from '@holons/core/tasks';
import type { ToolDeps } from './index.js';

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message }, null, 2) }] };
}

const board = z.string().describe('The board holon: the Pot, or an event holon.');
const quest = z.string().describe('The quest id (the propose entry id).');
const need = z.object({
  label: z.string(),
  quantity: z.number().positive(),
  unit: z.string().optional().describe("'people' makes it a headcount, covered by who joins."),
});

export function registerQuestsTools(server: McpServer, deps: ToolDeps): void {
  const run = (fn: (hs: any, party: string, name?: string) => Promise<unknown>) => async () => {
    try {
      const hs = await deps.getHoloSphere();
      const actor = deps.resolveActor();
      const name = actor.first_name || actor.username || undefined;
      return ok({ success: true, ...((await fn(hs, String(actor.id), name)) as object) });
    } catch (err) {
      return fail((err as Error).message);
    }
  };

  server.registerTool(
    'quest_board_list',
    {
      description:
        "The quests on a board, folded: each with its needs (covered / quantity), pledges, who is in or curious, and state — open, assembled (every need covered; pledges are due), lapsed (time box ended first; pledges released), done or cancelled. Filter by state.",
      inputSchema: { board, state: z.enum(['open', 'assembled', 'lapsed', 'done', 'cancelled']).optional() },
    },
    async (args) =>
      run(async (hs) => {
        const { quests } = await loadQuestBoard(hs, args.board);
        return { quests: args.state ? quests.filter((q) => q.state === args.state) : quests };
      })(),
  );

  server.registerTool(
    'quest_propose',
    {
      description: 'Put a quest on a board: a goal, what it needs (each a quantity in a unit; unit "people" is a headcount) and when the time box ends.',
      inputSchema: {
        board,
        title: z.string(),
        summary: z.string().optional(),
        until: z.number().describe('End of the time box, ms since epoch.'),
        needs: z.array(need).min(1),
        holon: z.string().optional().describe('The holon it is proposed for (a project or fund), if any.'),
      },
    },
    async (args) => run(async (hs, party, name) => proposeQuest(hs, args.board, { party, name, title: args.title, summary: args.summary, until: args.until, needs: args.needs, holon: args.holon }))(),
  );

  server.registerTool(
    'quest_join',
    {
      description: "Say you are in a quest, or curious about it. leave: true drops your standing.",
      inputSchema: { board, quest, level: z.enum(['in', 'curious']).optional(), leave: z.boolean().optional() },
    },
    async (args) =>
      run(async (hs, party, name) => (args.leave ? leaveQuest(hs, args.board, { quest: args.quest, party }) : joinQuest(hs, args.board, { quest: args.quest, party, level: args.level, name })))(),
  );

  server.registerTool(
    'quest_pledge',
    {
      description: 'Pledge to cover part of one of a quest’s needs (not a headcount: join for that). withdraw: <pledge id> takes your pledge back instead.',
      inputSchema: {
        board,
        quest,
        need: z.string().optional().describe('The need id (n1, n2, … or an added need’s id).'),
        quantity: z.number().positive().optional(),
        note: z.string().optional(),
        withdraw: z.string().optional(),
      },
    },
    async (args) =>
      run(async (hs, party, name) => {
        if (args.withdraw) return withdrawPledge(hs, args.board, { quest: args.quest, pledge: args.withdraw, party });
        if (!args.need || !args.quantity) throw new Error('A pledge names a need and a quantity');
        return pledgeToQuest(hs, args.board, { quest: args.quest, need: args.need, party, quantity: args.quantity, note: args.note, name });
      })(),
  );

  server.registerTool(
    'quest_add_need',
    { description: 'Add a need a quest did not list. Anyone may.', inputSchema: { board, quest, ...need.shape } },
    async (args) => run(async (hs, party) => addQuestNeed(hs, args.board, { quest: args.quest, party, label: args.label, quantity: args.quantity, unit: args.unit }))(),
  );

  server.registerTool(
    'quest_close',
    { description: 'Close a quest as done or cancelled: who proposed it, or an admin of the board.', inputSchema: { board, quest, outcome: z.enum(['done', 'cancelled']) } },
    async (args) => run(async (hs, party) => closeQuest(hs, args.board, { quest: args.quest, party, outcome: args.outcome }))(),
  );
}
