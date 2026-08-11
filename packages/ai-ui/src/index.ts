// @holons/ai-ui — Claude tool-use loop over @holons/core/commands.
//
// Re-exports the agent + tool-conversion helpers so the package can be
// embedded in another runtime (e.g. a web service, telegram-ui adapter).
// The bin entry lives in ./cli.ts and is wired via package.json.

export { runAgent, type AgentOptions, type AgentResult } from './agent.js';
export {
  toolFromCommand,
  toolsFromRegistry,
  loadTools,
  type ToolDefinition,
} from './tools.js';
export {
  loadRegistry,
  getFallbackRegistry,
  type CoreCommand,
  type CoreCommandParam,
  type CommandRegistry,
} from './commands.js';

// Turn-harness guards — deterministic checks (tool audit, claim check,
// corrective pass) shared by every agent-loop embedder, so no UI re-implements
// the "never claim an action without a successful write" contract.
export {
  claimsCompletedAction,
  correctionHistory,
  correctionPrompt,
  hasSuccessfulWrite,
  hasWriteAttempt,
  isWriteTool,
  looksLikeActionRequest,
  type ToolAudit,
} from './harness.js';

// Provider-neutral agent primitives — for embedders that supply their own
// tool source (e.g. an MCP client) and/or LLM backend (e.g. local mlx_lm).
export {
  runAgentLoop,
  type AgentLoopParams,
  type AgentLoopResult,
} from './providers/loop.js';
export {
  type AgentTool,
  type ToolCall,
  type ToolResult,
  type ToolDispatcher,
  type TurnOutput,
  type HistoryMessage,
  type LLMProvider,
  type LLMTurnRunner,
} from './providers/types.js';
export {
  AnthropicProvider,
  ANTHROPIC_DEFAULT_MODEL,
  type AnthropicProviderOptions,
} from './providers/anthropic.js';
export {
  OpenAICompatProvider,
  type OpenAICompatProviderOptions,
} from './providers/openai-compat.js';
