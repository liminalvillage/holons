// Anthropic (Claude) LLM provider.
//
// Normalizes the neutral agent primitives to/from Claude's tool_use /
// tool_result content blocks. The model call itself is @holons/core/ai's
// complete() — the same model default, effort, refusal fallback and error
// mapping every other Holons surface uses. The system prompt is cached, and
// tools render before it, so one breakpoint caches both across turns.

import Anthropic from '@anthropic-ai/sdk';
import { AI_DEFAULT_MODEL, complete, type AIEffort } from '@holons/core/ai';
import type {
  AgentTool,
  HistoryMessage,
  LLMProvider,
  LLMTurnRunner,
  ToolResult,
  TurnOutput,
} from './types.js';

export const ANTHROPIC_DEFAULT_MODEL = AI_DEFAULT_MODEL;

export interface AnthropicProviderOptions {
  /** Inject a client (tests, custom retry). Otherwise constructed from env. */
  client?: Anthropic;
  model?: string;
  maxTokens?: number;
  /** How hard the model thinks per turn (voice wants `low` for latency). */
  effort?: AIEffort;
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

    const tools: Anthropic.Beta.BetaTool[] = params.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
    }));

    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...(params.history ?? []).map(
        (m): Anthropic.Beta.BetaMessageParam =>
          m.role === 'user'
            ? { role: 'user', content: m.content }
            : { role: 'assistant', content: m.content },
      ),
      { role: 'user', content: params.userPrompt },
    ];
    let pending: ToolResult[] | null = null;

    const opts = this.opts;
    return {
      transcript: () => messages,
      submitToolResults(results: ToolResult[]) {
        pending = results;
      },
      async step(): Promise<TurnOutput> {
        if (pending) {
          // All results of one turn go back in ONE user message — splitting
          // them teaches the model to stop calling tools in parallel.
          messages.push({
            role: 'user',
            content: pending.map((r) => ({
              type: 'tool_result' as const,
              tool_use_id: r.id,
              content: r.content,
              is_error: r.isError,
            })),
          });
          pending = null;
        }

        const response = await complete({
          client,
          model,
          system: params.system,
          cacheSystem: true,
          tools,
          messages,
          effort: opts.effort ?? 'medium',
          maxTokens: opts.maxTokens,
        });
        // The whole content (thinking included) goes back unchanged: the
        // history stays append-only, which thinking blocks require.
        messages.push({ role: 'assistant', content: response.content });

        const toolCalls = response.content
          .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
          .map((b) => ({
            id: b.id,
            name: b.name,
            input: (b.input ?? {}) as Record<string, unknown>,
          }));

        const done = response.stopReason !== 'tool_use' || toolCalls.length === 0;

        return {
          text: response.text,
          toolCalls,
          done,
          stopReason: response.stopReason,
        };
      },
    };
  }
}
