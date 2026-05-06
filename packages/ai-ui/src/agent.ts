// Anthropic tool-use loop over the @holons/core/commands registry.
//
// Architecture:
//   - System prompt + tools are cached (cache_control: ephemeral) since they
//     don't change across turns within a session.
//   - On each turn we send the running message history. When the assistant
//     emits tool_use blocks, we dispatch them through the registry and feed
//     tool_result blocks back. Loop terminates on stop_reason === 'end_turn'
//     (or when no tool_use blocks are present, defensive against API drift).

import Anthropic from '@anthropic-ai/sdk';
import { loadTools, type ToolDefinition } from './tools.js';
import type { CommandRegistry } from './commands.js';

export interface AgentOptions {
  /** Anthropic model ID. */
  model?: string;
  /** Hard cap on tool-use turns (defensive, prevents runaway loops). */
  maxIterations?: number;
  /** System prompt — caller can override or extend the default. */
  system?: string;
  /** Per-response token budget. */
  maxTokens?: number;
  /** Inject a pre-built client (e.g. for tests or custom retry policy). */
  client?: Anthropic;
  /** Pre-loaded registry/tools (avoids re-importing for each call). */
  registry?: CommandRegistry;
  tools?: ToolDefinition[];
}

export interface AgentResult {
  /** Final assistant text concatenated across the run. */
  text: string;
  /** Number of API turns executed. */
  iterations: number;
  /** Last stop reason returned by the API. */
  stopReason: string | null;
  /** Full message transcript (user + assistant) for inspection. */
  messages: Anthropic.MessageParam[];
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_SYSTEM =
  'You are the Holons assistant. You help users manage tasks, hours, and ' +
  'shopping lists across their holons by calling the available tools. Always ' +
  'call a tool when the user requests an action; never fabricate results. ' +
  'After tools complete, summarize what was done in one sentence.';

/**
 * Run the agent loop against a natural-language prompt. Returns when the
 * model stops requesting tools or maxIterations is hit.
 */
export async function runAgent(
  prompt: string,
  options: AgentOptions = {},
): Promise<AgentResult> {
  const client = options.client ?? new Anthropic();
  const model = options.model ?? DEFAULT_MODEL;
  const maxIterations = options.maxIterations ?? 10;
  const maxTokens = options.maxTokens ?? 4096;
  const system = options.system ?? DEFAULT_SYSTEM;

  let registry = options.registry;
  let tools = options.tools;
  if (!registry || !tools) {
    const loaded = await loadTools();
    registry = registry ?? loaded.registry;
    tools = tools ?? loaded.tools;
  }

  // Render order is tools → system → messages, so a single cache_control
  // breakpoint on the system block caches both tools and system together.
  // Keeps us well under the 4-breakpoint cap and avoids needless writes.
  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
  ];

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: prompt },
  ];

  let iterations = 0;
  let stopReason: string | null = null;
  const textChunks: string[] = [];

  while (iterations < maxIterations) {
    iterations++;
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemBlocks,
      tools,
      messages,
    });

    stopReason = response.stop_reason;
    messages.push({ role: 'assistant', content: response.content });

    // Collect any text the assistant produced this turn.
    for (const block of response.content) {
      if (block.type === 'text') textChunks.push(block.text);
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    if (toolUses.length === 0 || response.stop_reason === 'end_turn') {
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const cmd = registry.get(tu.name);
      if (!cmd) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: `error: unknown tool "${tu.name}"`,
          is_error: true,
        });
        continue;
      }
      try {
        const result = await cmd.execute(
          (tu.input ?? {}) as Record<string, unknown>,
        );
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result),
          is_error: !result.ok,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: `error: ${msg}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return {
    text: textChunks.join('\n'),
    iterations,
    stopReason,
    messages,
  };
}
