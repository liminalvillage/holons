// Thin MCP wrappers around @holons/core/tags. Tags live under the `tags` lens,
// keyed by keyword; all aggregation logic is owned by core.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTagEntries, tagMessage, type TagsDB } from '@holons/core/tags';
import type { ToolDeps } from './index.js';

function ok(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function fail(message: string) {
  return {
    isError: true,
    content: [
      { type: 'text' as const, text: JSON.stringify({ success: false, error: message }, null, 2) },
    ],
  };
}

async function db(deps: ToolDeps): Promise<TagsDB> {
  return (await deps.getHoloSphere()) as unknown as TagsDB;
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

export function registerTagsTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'tag_add',
    {
      description:
        'File a snippet under a keyword. Wraps @holons/core/tags tagMessage (lens "tags"); persists the merged tag object.',
      inputSchema: {
        holon: z.string(),
        keyword: z.string().describe('Tag keyword.'),
        text: z.string().describe('Text/link to remember.'),
        messageId: z
          .union([z.string(), z.number()])
          .optional()
          .describe('Source message id; defaults to a generated id.'),
      },
    },
    async (args) => {
      try {
        const updated = await tagMessage(await db(deps), args.holon, args.keyword.trim(), {
          holonId: args.holon,
          messageId: args.messageId ?? genId(),
          messageContent: args.text,
        });
        return ok({ success: true, tag: updated });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'tag_get',
    {
      description: 'List everything filed under a keyword. Wraps getTagEntries.',
      inputSchema: { holon: z.string(), keyword: z.string() },
    },
    async (args) => {
      try {
        const entries = await getTagEntries(await db(deps), args.holon, args.keyword.trim());
        return ok({ success: true, keyword: args.keyword, count: entries.length, entries });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
