// Provider-neutral primitives for the agent loop.
//
// The loop (loop.ts) is written against these types so it can drive any LLM
// backend (Anthropic, OpenAI-compatible, …) over any tool source (the
// @holons/core commands registry, an MCP client, …). Each concrete provider
// owns its own native message history and normalizes to/from these shapes.

/** A tool the model may call, in a provider-neutral shape. */
export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema object describing the tool input. */
  inputSchema: Record<string, unknown>;
}

/** A tool invocation emitted by the model. */
export interface ToolCall {
  /** Provider-assigned id, echoed back with the result. */
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** The outcome of dispatching a ToolCall. */
export interface ToolResult {
  id: string;
  content: string;
  isError: boolean;
}

/** Executes a tool call and returns its result. */
export type ToolDispatcher = (call: ToolCall) => Promise<ToolResult>;

/**
 * A prior conversation exchange, replayed ahead of the fresh prompt to give
 * the model short-term memory across runs. Text-only by design: tool_use
 * blocks from earlier runs are provider-specific and expensive to replay, and
 * the assistant text already summarizes what the tools did.
 */
export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** One assistant turn, normalized across providers. */
export interface TurnOutput {
  /** Assistant text produced this turn (may be empty on a pure tool turn). */
  text: string;
  /** Tool calls the assistant is requesting. */
  toolCalls: ToolCall[];
  /** True when the model has finished (no further tools expected). */
  done: boolean;
  /** Raw provider stop/finish reason, for inspection. */
  stopReason: string | null;
}

/**
 * A live conversation with a provider. The provider owns the native message
 * history; the loop only calls step()/submitToolResults().
 */
export interface LLMTurnRunner {
  /** Run one model turn against the current history. */
  step(): Promise<TurnOutput>;
  /** Queue tool results to be sent on the next step(). */
  submitToolResults(results: ToolResult[]): void;
  /** Provider-native message history, for inspection/debugging. */
  transcript(): unknown[];
}

/** Factory for a conversation. Providers are cheap, stateless handles. */
export interface LLMProvider {
  /** Stable identifier, e.g. 'anthropic' | 'openai-compat'. */
  readonly name: string;
  begin(params: {
    system: string;
    tools: AgentTool[];
    userPrompt: string;
    /** Prior exchanges to replay before the prompt (oldest first). */
    history?: HistoryMessage[];
  }): LLMTurnRunner;
}
