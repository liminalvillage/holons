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
