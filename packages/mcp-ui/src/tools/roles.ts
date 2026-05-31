// Thin MCP wrappers around @holons/core/roles. Roles live under the `roles`
// lens; all logic (participant toggle, legacy migration, checklist-cascade
// delete, completion tallies) is owned by core — these tools only marshal args
// and persist.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  clearAllRoles,
  createRole,
  deleteRoleWithChecklist,
  getRole,
  getRoleByTitle,
  listRoles,
  saveRole,
  toggleParticipant,
  type RoleParticipant,
  type RolesDB,
} from '@holons/core/roles';
import type { ToolDeps } from './index.js';

function ok(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function fail(message: string, extra?: Record<string, unknown>) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: message, ...(extra ?? {}) }, null, 2),
      },
    ],
  };
}

async function db(deps: ToolDeps): Promise<RolesDB> {
  return (await deps.getHoloSphere()) as unknown as RolesDB;
}

export function registerRolesTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'role_create',
    {
      description:
        'Create a holon role. Wraps @holons/core/roles createRole + saveRole (lens "roles"). Id mirrors the title.',
      inputSchema: {
        holon: z.string().describe('Holon id.'),
        title: z.string().describe('Role title (also its id).'),
        description: z.string().optional().describe('What the role does.'),
      },
    },
    async (args) => {
      try {
        const role = createRole(args.title.trim(), args.description ?? '');
        await saveRole(await db(deps), args.holon, role);
        return ok({ success: true, role });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'role_list',
    {
      description: 'List a holon\'s roles (participants normalized). Wraps listRoles.',
      inputSchema: { holon: z.string() },
    },
    async (args) => {
      try {
        const roles = await listRoles(await db(deps), args.holon);
        return ok({ success: true, count: roles.length, roles });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'role_toggle_participant',
    {
      description:
        'Toggle the acting user (or a supplied participant) in/out of a role. Wraps @holons/core/roles toggleParticipant + saveRole. Identify the role by id or title.',
      inputSchema: {
        holon: z.string(),
        role: z.string().describe('Role id or title.'),
        participant: z
          .string()
          .optional()
          .describe('JSON {id, username?, first_name?, last_name?}. Defaults to the acting MCP actor.'),
      },
    },
    async (args) => {
      try {
        const store = await db(deps);
        const role =
          (await getRole(store, args.holon, args.role)) ??
          (await getRoleByTitle(store, args.holon, args.role));
        if (!role) return fail(`Role "${args.role}" not found.`);

        let user: RoleParticipant;
        if (args.participant) {
          user = JSON.parse(args.participant) as RoleParticipant;
        } else {
          const actor = deps.resolveActor();
          user = { id: actor.id, username: actor.username ?? null, first_name: actor.first_name ?? null };
        }
        const { role: updated, joined } = toggleParticipant(role, user);
        await saveRole(store, args.holon, updated);
        return ok({ success: true, joined, role: updated });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'role_remove',
    {
      description:
        'Delete a role (and its linked checklist, if any). Wraps deleteRoleWithChecklist. Identify by id or title.',
      inputSchema: { holon: z.string(), role: z.string() },
    },
    async (args) => {
      try {
        const store = await db(deps);
        const role =
          (await getRole(store, args.holon, args.role)) ??
          (await getRoleByTitle(store, args.holon, args.role));
        if (!role) return fail(`Role "${args.role}" not found.`);
        await deleteRoleWithChecklist(store, args.holon, role);
        return ok({ success: true, removed: role.id });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'role_clear',
    {
      description:
        'Clear participants from every role, tallying each member\'s stint onto their user record. Wraps clearAllRoles.',
      inputSchema: { holon: z.string() },
    },
    async (args) => {
      try {
        const roles = await clearAllRoles(await db(deps), args.holon);
        return ok({ success: true, cleared: roles.length, roles });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
