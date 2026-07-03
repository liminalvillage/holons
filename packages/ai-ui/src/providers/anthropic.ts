// Anthropic (Claude) LLM provider.
//
// Normalizes the neutral agent primitives to/from Anthropic's tool_use /
// tool_result content blocks. System + tools share a single cache_control
// breakpoint (they don't change across turns), matching the original loop.

import Anthropic from '@anthropic-ai/sdk';
import type {
  AgentTool,
  HistoryMessage,
  LLMProvider,
  LLMTurnRunner,
  ToolResult,
  TurnOutput,
} from './types.js';

export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-4-6';

export interface AnthropicProviderOptions {
  /** Inject a client (tests, custom retry). Otherwise constructed from env. */
  client?: Anthropic;
  model?: string;
  maxTokens?: number;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';

  constructor(private readonly opts: AnthropicProviderOptions = {}) {}

  begin(params: {
    system: string;
    tools: AgentTool[];
    userPrompt: string;
    history?: HistoryMessage[];
  }): LLMTurnRunner {
    const client = this.opts.client ?? new Anthropic();
    const model = this.opts.model ?? ANTHROPIC_DEFAULT_MODEL;
    const maxTokens = this.opts.maxTokens ?? 4096;

    const tools: Anthropic.Tool[] = params.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    // Render order is tools → system → messages, so one cache_control
    // breakpoint on system caches both tools and system together.
    const systemBlocks: Anthropic.TextBlockParam[] = [
      { type: 'text', text: params.system, cache_control: { type: 'ephemeral' } },
    ];

    const messages: Anthropic.MessageParam[] = [
      ...(params.history ?? []).map(
        (m): Anthropic.MessageParam => ({ role: m.role, content: m.content }),
      ),
      { role: 'user', content: params.userPrompt },
    ];
    let pending: ToolResult[] | null = null;

    return {
      transcript: () => messages,
      submitToolResults(results: ToolResult[]) {
        pending = results;
      },
      async step(): Promise<TurnOutput> {
        if (pending) {
          messages.push({
            role: 'user',
            content: pending.map((r) => ({
              type: 'tool_result',
              tool_use_id: r.id,
              content: r.content,
              is_error: r.isError,
            })),
          });
          pending = null;
        }

        const response = await client.messages.create({
          model,
          max_tokens: maxTokens,
          system: systemBlocks,
          tools,
          messages,
        });
        messages.push({ role: 'assistant', content: response.content });

        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');

        const toolCalls = response.content
          .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
          .map((b) => ({
            id: b.id,
            name: b.name,
            input: (b.input ?? {}) as Record<string, unknown>,
          }));

        const done =
          response.stop_reason === 'end_turn' || toolCalls.length === 0;

        return { text, toolCalls, done, stopReason: response.stop_reason };
      },
    };
  }
}
