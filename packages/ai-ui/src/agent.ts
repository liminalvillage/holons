// Claude tool-use loop over the @holons/core/commands registry.
//
// This is a thin default wiring of the provider-neutral loop in ./providers:
//   - LLM backend: AnthropicProvider (Claude), system+tools cached.
//   - Tool source: the commands registry, dispatched via cmd.execute().
// The generalized primitives (runAgentLoop, LLMProvider, providers) are
// exported for embedders (e.g. voice-ui) that supply their own tool source
// (MCP) and/or LLM provider (local mlx_lm.server).

import type Anthropic from '@anthropic-ai/sdk';
import { loadTools, type ToolDefinition } from './tools.js';
import type { CommandRegistry } from './commands.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { runAgentLoop } from './providers/loop.js';
import type {
  AgentTool,
  ToolCall,
  ToolDispatcher,
  ToolResult,
} from './providers/types.js';

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

const DEFAULT_SYSTEM =
  'You are the Holons assistant. You help users manage tasks, hours, and ' +
  'shopping lists across their holons by calling the available tools. Always ' +
  'call a tool when the user requests an action; never fabricate results. ' +
  'After tools complete, summarize what was done in one sentence.';

/** Adapt an Anthropic tool definition to the neutral AgentTool shape. */
function toAgentTool(t: ToolDefinition): AgentTool {
  return {
    name: t.name,
    description: t.description ?? '',
    inputSchema: t.input_schema as unknown as Record<string, unknown>,
  };
}

/** Build a dispatcher that routes tool calls through the commands registry. */
function registryDispatcher(registry: CommandRegistry): ToolDispatcher {
  return async (call: ToolCall): Promise<ToolResult> => {
    const cmd = registry.get(call.name);
    if (!cmd) {
      return {
        id: call.id,
        content: `error: unknown tool "${call.name}"`,
        isError: true,
      };
    }
    try {
      const result = await cmd.execute(call.input);
      return {
        id: call.id,
        content: JSON.stringify(result),
        isError: !result.ok,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { id: call.id, content: `error: ${msg}`, isError: true };
    }
  };
}

/**
 * Run the agent loop against a natural-language prompt. Returns when the
 * model stops requesting tools or maxIterations is hit.
 */
export async function runAgent(
  prompt: string,
  options: AgentOptions = {},
): Promise<AgentResult> {
  let registry = options.registry;
  let tools = options.tools;
  if (!registry || !tools) {
    const loaded = await loadTools();
    registry = registry ?? loaded.registry;
    tools = tools ?? loaded.tools;
  }

  const provider = new AnthropicProvider({
    client: options.client,
    model: options.model,
    maxTokens: options.maxTokens,
  });

  const result = await runAgentLoop({
    provider,
    tools: tools.map(toAgentTool),
    dispatch: registryDispatcher(registry),
    system: options.system ?? DEFAULT_SYSTEM,
    prompt,
    maxIterations: options.maxIterations,
  });

  return {
    text: result.text,
    iterations: result.iterations,
    stopReason: result.stopReason,
    messages: result.transcript as Anthropic.MessageParam[],
  };
}
