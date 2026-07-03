import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from './anthropic.js';
import { OpenAICompatProvider } from './openai-compat.js';
import { runAgentLoop } from './loop.js';
import type { AgentTool, HistoryMessage, ToolCall } from './types.js';

const TOOLS: AgentTool[] = [
  {
    name: 'task_create',
    description: 'Create a task',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    },
  },
];

describe('LLM provider normalization', () => {
  it('Anthropic tool_use → neutral ToolCall, then end_turn', async () => {
    let turn = 0;
    const fakeClient = {
      messages: {
        create: async () => {
          turn++;
          if (turn === 1) {
            return {
              stop_reason: 'tool_use',
              content: [
                { type: 'text', text: 'ok' },
                {
                  type: 'tool_use',
                  id: 'a1',
                  name: 'task_create',
                  input: { title: 'roof' },
                },
              ],
            };
          }
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] };
        },
      },
    } as unknown as Anthropic;

    const provider = new AnthropicProvider({ client: fakeClient });
    const seen: ToolCall[] = [];
    const res = await runAgentLoop({
      provider,
      tools: TOOLS,
      system: 's',
      prompt: 'make a task',
      onToolCall: (c) => seen.push(c),
      dispatch: async (c) => ({ id: c.id, content: '{"ok":true}', isError: false }),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ name: 'task_create', input: { title: 'roof' } });
    expect(res.text).toContain('done');
    expect(res.iterations).toBe(2);
  });

  it('OpenAI-compatible tool_calls → neutral ToolCall, then stop', async () => {
    let turn = 0;
    const fetchImpl = (async () => {
      turn++;
      const body =
        turn === 1
          ? {
              choices: [
                {
                  finish_reason: 'tool_calls',
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: 'o1',
                        function: {
                          name: 'task_create',
                          arguments: '{"title":"roof"}',
                        },
                      },
                    ],
                  },
                },
              ],
            }
          : {
              choices: [
                { finish_reason: 'stop', message: { role: 'assistant', content: 'done' } },
              ],
            };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new OpenAICompatProvider({
      baseUrl: 'http://localhost:1234/v1',
      model: 'local',
      fetchImpl,
    });
    const seen: ToolCall[] = [];
    const res = await runAgentLoop({
      provider,
      tools: TOOLS,
      system: 's',
      prompt: 'make a task',
      onToolCall: (c) => seen.push(c),
      dispatch: async (c) => ({ id: c.id, content: '{"ok":true}', isError: false }),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ name: 'task_create', input: { title: 'roof' } });
    expect(res.text).toContain('done');
    expect(res.iterations).toBe(2);
  });

  it('replays history ahead of the fresh prompt on both providers', async () => {
    const history: HistoryMessage[] = [
      { role: 'user', content: 'create a task called roof' },
      { role: 'assistant', content: 'Created task "roof".' },
    ];

    let anthropicMessages: Anthropic.MessageParam[] = [];
    const fakeClient = {
      messages: {
        create: async (req: { messages: Anthropic.MessageParam[] }) => {
          anthropicMessages = [...req.messages];
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
        },
      },
    } as unknown as Anthropic;
    await runAgentLoop({
      provider: new AnthropicProvider({ client: fakeClient }),
      tools: [],
      system: 's',
      prompt: 'add me to it',
      history,
      dispatch: async (c) => ({ id: c.id, content: '', isError: false }),
    });
    expect(anthropicMessages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
    expect(anthropicMessages[2].content).toBe('add me to it');

    let openaiMessages: { role: string; content?: string | null }[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      openaiMessages = (JSON.parse(String(init.body)) as {
        messages: { role: string; content?: string | null }[];
      }).messages;
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    await runAgentLoop({
      provider: new OpenAICompatProvider({
        baseUrl: 'http://localhost:1234/v1',
        model: 'local',
        fetchImpl,
      }),
      tools: [],
      system: 's',
      prompt: 'add me to it',
      history,
      dispatch: async (c) => ({ id: c.id, content: '', isError: false }),
    });
    expect(openaiMessages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(openaiMessages[3].content).toBe('add me to it');
  });
});
