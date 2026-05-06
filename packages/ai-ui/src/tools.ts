// Anthropic tool-use definitions derived from the @holons/core/commands registry.
//
// Each CoreCommand becomes an Anthropic tool with a JSON Schema input
// generated from its `params`. Required-param enforcement, type coercion,
// and execution are delegated back to the command's own `execute()`.

import type Anthropic from '@anthropic-ai/sdk';
import {
  getFallbackRegistry,
  loadRegistry,
  type CommandRegistry,
  type CoreCommand,
  type CoreCommandParam,
} from './commands.js';

export type ToolDefinition = Anthropic.Tool;

/** Map a CoreCommand to an Anthropic tool definition. */
export function toolFromCommand(cmd: CoreCommand): ToolDefinition {
  const properties: Record<string, { type: string; description: string }> = {};
  const required: string[] = [];
  for (const p of cmd.params) {
    properties[p.name] = { type: jsonType(p.type), description: p.description };
    if (p.required) required.push(p.name);
  }
  return {
    name: cmd.name,
    description: cmd.description,
    input_schema: {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
  };
}

function jsonType(t: CoreCommandParam['type']): string {
  switch (t) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'string';
  }
}

/**
 * Synchronous: return tool definitions from the fallback (or the supplied) registry.
 * Used by smoke tests and embedders that already hold a registry.
 */
export function toolsFromRegistry(registry?: CommandRegistry): ToolDefinition[] {
  const reg = registry ?? getFallbackRegistry();
  return reg.list().map(toolFromCommand);
}

/**
 * Async: load `@holons/core/commands` (or fallback) and return its tools.
 * Preferred entry point for the agent at runtime.
 */
export async function loadTools(): Promise<{
  tools: ToolDefinition[];
  registry: CommandRegistry;
}> {
  const registry = await loadRegistry();
  return { tools: registry.list().map(toolFromCommand), registry };
}
