// Thin MCP wrappers around @holons/core/announcements. Announcements live under
// the `announcements` lens; core owns the record shape, federation target
// selection and lens-permission rule. Delivery (sending messages) is a UI
// concern and is not handled here.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createAnnouncement,
  listAnnouncements,
  saveAnnouncement,
  selectFederationTargets,
  targetAcceptsLens,
  type AnnouncementsDB,
  type FederationInfo,
} from '@holons/core/announcements';
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

async function db(deps: ToolDeps): Promise<AnnouncementsDB> {
  return (await deps.getHoloSphere()) as unknown as AnnouncementsDB;
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

export function registerAnnouncementsTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'announcement_create',
    {
      description:
        'Record a community announcement. Wraps @holons/core/announcements createAnnouncement + saveAnnouncement (lens "announcements"). Delivery to channels/partners is a UI concern.',
      inputSchema: {
        holon: z.string().describe('Source holon id.'),
        text: z.string().describe('Announcement text.'),
      },
    },
    async (args) => {
      try {
        const actor = deps.resolveActor();
        const announcement = createAnnouncement({
          id: genId(),
          content: args.text,
          chat: args.holon,
          user: { id: actor.id, username: actor.username },
        });
        await saveAnnouncement(await db(deps), announcement);
        return ok({ success: true, announcement });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'announcement_list',
    {
      description: 'List a holon\'s announcements (newest first). Wraps listAnnouncements.',
      inputSchema: { holon: z.string() },
    },
    async (args) => {
      try {
        const announcements = await listAnnouncements(await db(deps), args.holon);
        return ok({ success: true, count: announcements.length, announcements });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'announcement_federation_targets',
    {
      description:
        'Compute which federated partner holons would receive an announcement from this holon (outbound minus self, filtered to those whose inbound accepts the "announcements" lens). Wraps selectFederationTargets + targetAcceptsLens.',
      inputSchema: { holon: z.string() },
    },
    async (args) => {
      try {
        const hs = (await deps.getHoloSphere()) as {
          getFederation?: (id: string) => Promise<FederationInfo | null>;
        };
        if (typeof hs.getFederation !== 'function') {
          return ok({ success: true, targets: [], note: 'HoloSphere has no getFederation in this environment.' });
        }
        const fed = await hs.getFederation(args.holon);
        const candidates = selectFederationTargets(fed, args.holon);
        const targets: string[] = [];
        for (const t of candidates) {
          const targetFed = await hs.getFederation(t);
          if (targetAcceptsLens(targetFed, args.holon)) targets.push(t);
        }
        return ok({ success: true, candidates, targets });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
