// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Private scopes — thin wrappers over @holons/core/privacy. A scope is a
// lens of a holon or one item of it; it is locked or unlocked, and shared
// with HOLONS. The MCP instance signs with its own key: it owns the vaults it
// creates. No tool here takes or returns a key.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { audience, lock, privacyOfHolon, share, sync, unlock, unshare, type Scope } from '@holons/core/privacy';
import type { ToolDeps } from './index.js';

function ok(payload: object) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ success: true, ...payload }, null, 2) }],
  };
}

function fail(error: string, extra: Record<string, unknown> = {}) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error, ...extra }, null, 2) }],
    isError: true,
  };
}

const SCOPE = {
  holon: z.string().describe('Holon id.'),
  lens: z.string().describe('Lens name (quests, library, roles, checklists, stock).'),
  item: z.string().optional().describe('One item id — the scope is that card alone. Omit for the whole lens.'),
};

const scopeOf = (args: { holon: string; lens: string; item?: string }): Scope =>
  args.item ? { holon: args.holon, lens: args.lens, item: args.item } : { holon: args.holon, lens: args.lens };

export function registerPrivacyTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'privacy_lock',
    {
      description:
        'Make a lens, or one item of it, private: its content is sealed (NIP-44) on the relays and only the members of the holon, plus the holons it is shared with, can read it. A card can be locked on its own only while its lens is public. Never allowed for settings, _members, users, append-only logs or standard-kind lenses.',
      inputSchema: SCOPE,
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        return ok(await lock(hs, scopeOf(args)));
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'privacy_unlock',
    {
      description: 'Make a private lens or item public again: its content is rewritten in the clear.',
      inputSchema: SCOPE,
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        return ok(await unlock(hs, scopeOf(args)));
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'privacy_share',
    {
      description:
        'Let another holon read a private lens or item. Give the holon id (a personal holon id, a Telegram chat id, or a key-founded holon id). Core resolves it to the keys that read on its behalf and hands them the key over NIP-17; the readers appear as counts, never as keys.',
      inputSchema: { ...SCOPE, with: z.string().describe('The holon that may read it.') },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        return ok(await share(hs, scopeOf(args), args.with));
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'privacy_unshare',
    {
      description:
        'Stop a holon from reading a private lens or item: the scope key rotates and the content is rewritten (forward-only — what was already read stays read).',
      inputSchema: { ...SCOPE, with: z.string().describe('The holon to remove from the audience.') },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        return ok(await unshare(hs, scopeOf(args), args.with));
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'privacy_audience',
    {
      description:
        'Who may read a lens or item: whether it is locked, whether this identity owns it, and the holons in its audience with reader counts and sync status. The owner holon is always listed first.',
      inputSchema: SCOPE,
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        return ok(await audience(hs, scopeOf(args)));
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'privacy_of',
    {
      description: 'The private scopes of a holon, by lens: which lenses are locked as a whole and which single items are. Needs no key.',
      inputSchema: { holon: z.string() },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        return ok({ holon: args.holon, lenses: await privacyOfHolon(hs, args.holon) });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'privacy_sync',
    {
      description:
        'Bring every private scope this identity owns in a holon in line with its audience — after a membership change, say: new readers get the keys, departed ones lose them.',
      inputSchema: { holon: z.string() },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        return ok({ holon: args.holon, scopes: await sync(hs, args.holon) });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
