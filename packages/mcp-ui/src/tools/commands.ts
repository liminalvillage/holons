import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  commandRegistry,
  executeCommand,
  type CommandContext,
} from '@holons/core/commands';
import type { Actor } from '../identity.js';
import type { ToolDeps } from './index.js';

/**
 * Parse a JSON string argument, throwing a clear error if it is malformed.
 * Empty/undefined input falls back to `fallback`.
 */
function parseJson<T>(raw: string | undefined, label: string, fallback: T): T {
  if (raw === undefined || raw === null || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(
      `${label} must be valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * The MCP-UI surface accepts a friendlier `{ holon, actor, ... }` context shape
 * and translates it into the real `CommandContext` (`holonId`, `userId`,
 * `userName`, `holosphere`, ...). Anything extra is forwarded via `extra` so
 * downstream commands can opt in.
 */
interface ToolContext {
  holon?: string;
  holonId?: string;
  actor?: Partial<Actor>;
  userId?: string;
  userName?: string;
  source?: string;
  [k: string]: unknown;
}

async function buildCommandContext(
  raw: ToolContext,
  deps: ToolDeps
): Promise<CommandContext> {
  const actor = deps.resolveActor(raw.actor);
  const {
    holon,
    holonId,
    actor: _ignoredActor,
    userId,
    userName,
    source,
    ...extra
  } = raw;
  return {
    holonId: holonId ?? holon,
    userId: userId ?? (actor.id !== undefined ? String(actor.id) : undefined),
    userName: userName ?? actor.first_name ?? actor.username,
    source: source ?? 'mcp-ui',
    holosphere: await deps.getHoloSphere(),
    extra: {
      ...extra,
      actor,
    },
  };
}

function ok(payload: Record<string, unknown>) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ success: true, ...payload }, null, 2),
      },
    ],
  };
}

function fail(message: string, details?: unknown) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          { success: false, error: message, details },
          null,
          2
        ),
      },
    ],
  };
}

export function registerCommandsTools(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'command_execute',
    'Execute a registered @holons/core command by name. Built-ins include createTask, logHours, addToShoppingList.',
    {
      name: z.string().describe('Command name (e.g. "createTask")'),
      params: z
        .string()
        .describe('JSON-encoded params object for the command'),
      context: z
        .string()
        .describe(
          'JSON-encoded CommandContext. Should include `holon` (holon id) and optionally `actor` ({ id, first_name, username }).'
        ),
      options: z
        .string()
        .optional()
        .describe('JSON-encoded ExecuteOptions (rarely needed)'),
    },
    async ({ name, params, context, options }) => {
      try {
        const parsedParams = parseJson<unknown>(params, 'params', {});
        const parsedCtx = parseJson<ToolContext>(context, 'context', {});
        // ExecuteOptions only supports `registry` (a class instance), which
        // can't survive JSON round-tripping; we parse it for forward-compat
        // but never forward a `registry` field.
        const parsedOpts = parseJson<Record<string, unknown>>(
          options,
          'options',
          {}
        );
        const { registry: _ignoredRegistry, ...forwardOpts } = parsedOpts;

        const ctx = await buildCommandContext(parsedCtx, deps);
        const result = await executeCommand(name, parsedParams, ctx, forwardOpts);

        if (result.ok) {
          return ok({ command: result.command, data: result.data });
        }
        return fail(result.error.message, {
          code: result.error.code,
          command: result.command,
        });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    'command_list',
    'List every command registered on the shared @holons/core commandRegistry.',
    {},
    async () => {
      try {
        const commands = commandRegistry.all().map((c) => ({
          name: c.name,
          description: c.description,
          paramsSchema: c.paramsSchema,
        }));
        return ok({ count: commands.length, commands });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    }
  );
}
