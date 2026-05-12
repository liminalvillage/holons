import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createDefaultProfile,
  getUserProfile,
  getUsers,
  ensureUserProfile,
  saveUserProfile,
  addUserValues,
  addUserNeeds,
  joinHolon,
  leaveHolon,
  type TelegramUserLike,
  type UserDB,
  type UserProfile,
} from '@holons/core/users';
import type { ToolDeps } from './index.js';

const userIdSchema = z.union([z.string(), z.number()]);

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

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: message }, null, 2),
      },
    ],
    isError: true,
  };
}

function parseJson<T>(label: string, raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid JSON for "${label}": ${detail}`);
  }
}

/**
 * Resolve a TelegramUserLike for tools that take `{ userId, user? }`.
 * If `userJson` is provided, parse it; otherwise build a minimal stub from `userId`.
 * `userId` always wins the id field so parsed and stub paths stay consistent.
 */
function resolveTargetUser(userId: string | number, userJson?: string): TelegramUserLike {
  const base = userJson ? parseJson<TelegramUserLike>('user', userJson) : {};
  return { ...base, id: userId };
}

export function registerUsersTools(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'user_create_default_profile',
    'Build a default UserProfile object for the given TelegramUserLike (pure; no I/O).',
    {
      user: z.string().describe('JSON-encoded TelegramUserLike'),
    },
    async ({ user }) => {
      try {
        const u = parseJson<TelegramUserLike>('user', user);
        const profile = createDefaultProfile(u);
        return ok({ profile });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    'user_profile_get',
    'Load a user profile for a holon. Creates a default profile if absent.',
    {
      holon: z.string().describe('Holon id'),
      userId: userIdSchema.describe('Telegram-like user id'),
      user: z
        .string()
        .optional()
        .describe('Optional JSON-encoded TelegramUserLike for richer defaults'),
    },
    async ({ holon, userId, user }) => {
      try {
        const db = (await deps.getHoloSphere()) as UserDB;
        const u = resolveTargetUser(userId, user);
        const profile = await getUserProfile(db, u, holon);
        return ok({ profile });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    'user_profile_ensure',
    'Ensure a user profile exists for a holon (no-op if already present).',
    {
      holon: z.string().describe('Holon id'),
      user: z.string().describe('JSON-encoded TelegramUserLike'),
    },
    async ({ holon, user }) => {
      try {
        const db = (await deps.getHoloSphere()) as UserDB;
        const u = parseJson<TelegramUserLike>('user', user);
        await ensureUserProfile(db, u, holon);
        return ok({ ensured: true, userId: u.id, holon });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    'user_profile_save',
    'Persist an updated user profile against a holon.',
    {
      holon: z.string().describe('Holon id'),
      profile: z.string().describe('JSON-encoded UserProfile'),
    },
    async ({ holon, profile }) => {
      try {
        const db = (await deps.getHoloSphere()) as UserDB;
        const p = parseJson<UserProfile>('profile', profile);
        await saveUserProfile(db, holon, p);
        return ok({ saved: true, holon, userId: p.id });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    'users_list',
    'List every stored user profile in a holon.',
    {
      holon: z.string().describe('Holon id'),
    },
    async ({ holon }) => {
      try {
        const db = (await deps.getHoloSphere()) as UserDB;
        const users = await getUsers(db, holon);
        return ok({ users });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    'user_values_add',
    'Append (deduplicated) values to a user profile in a holon.',
    {
      holon: z.string().describe('Holon id'),
      userId: userIdSchema.describe('Telegram-like user id'),
      values: z.array(z.string()).describe('Values to append'),
      user: z
        .string()
        .optional()
        .describe('Optional JSON-encoded TelegramUserLike (for first-time profile creation)'),
    },
    async ({ holon, userId, values, user }) => {
      try {
        const db = (await deps.getHoloSphere()) as UserDB;
        const u = resolveTargetUser(userId, user);
        const profile = await addUserValues(db, u, holon, values);
        return ok({ profile });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    'user_needs_add',
    'Append (deduplicated) needs to a user profile in a holon.',
    {
      holon: z.string().describe('Holon id'),
      userId: userIdSchema.describe('Telegram-like user id'),
      needs: z.array(z.string()).describe('Needs to append'),
      user: z
        .string()
        .optional()
        .describe('Optional JSON-encoded TelegramUserLike (for first-time profile creation)'),
    },
    async ({ holon, userId, needs, user }) => {
      try {
        const db = (await deps.getHoloSphere()) as UserDB;
        const u = resolveTargetUser(userId, user);
        const profile = await addUserNeeds(db, u, holon, needs);
        return ok({ profile });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    'holon_join',
    'Join a holon by ensuring the user profile exists.',
    {
      holon: z.string().describe('Holon id'),
      user: z.string().describe('JSON-encoded TelegramUserLike'),
    },
    async ({ holon, user }) => {
      try {
        const db = (await deps.getHoloSphere()) as UserDB;
        const u = parseJson<TelegramUserLike>('user', user);
        const result = await joinHolon(db, u, holon);
        return ok({ joined: Boolean(result.profile), ...result });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    'holon_leave',
    'Leave a holon by deleting the user profile entry.',
    {
      holon: z.string().describe('Holon id'),
      userId: userIdSchema.describe('Telegram-like user id'),
    },
    async ({ holon, userId }) => {
      try {
        const db = (await deps.getHoloSphere()) as UserDB;
        const deleted = await leaveHolon(db, userId, holon);
        return ok({ deleted, holon, userId });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
