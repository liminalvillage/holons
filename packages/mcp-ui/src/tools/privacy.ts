// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Private lenses and key grants — thin wrappers over @holons/core/privacy.
// The MCP instance signs with its own key: it owns the vaults it creates, and
// grants it sends are signed by that key.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  acceptGrant,
  getPrivacySnapshot,
  grantItem,
  grantLens,
  listGrants,
  revokeItem,
  revokeLens,
  setLensPrivacy,
} from '@holons/core/privacy';
import type { ToolDeps } from './index.js';

function ok(payload: Record<string, unknown>) {
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

export function registerPrivacyTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'privacy_lens_set',
    {
      description:
        "Make a lens of a holon private (its content is sealed with NIP-44 on the relays; the owner's vault holds the key) or public again (new writes go out in the clear). Never allowed for settings, _members, users, append-only logs or standard-kind lenses.",
      inputSchema: {
        holon: z.string(),
        lens: z.string(),
        mode: z.enum(['private', 'public']),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const r = await setLensPrivacy(hs, args.holon, args.lens, args.mode);
        return ok({ holon: args.holon, ...r });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'privacy_get',
    {
      description:
        'The privacy state of a holon as this identity sees it: which lenses are private, which vaults it owns, and the grant ledger (who was handed which lens or item keys).',
      inputSchema: { holon: z.string() },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        return ok({ holon: args.holon, ...(await getPrivacySnapshot(hs, args.holon)) });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'privacy_grant_lens',
    {
      description:
        "Share a whole private lens with a grantee: a 64-hex Nostr pubkey, a personal holon id (which IS a pubkey) or a group holon id whose settings pin a holonPubkey. The lens key travels as a NIP-17 DM; the grantee's instance accepts it automatically.",
      inputSchema: { holon: z.string(), lens: z.string(), grantee: z.string() },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        return ok({ holon: args.holon, lens: args.lens, ...(await grantLens(hs, args.holon, args.lens, args.grantee)) });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'privacy_grant_item',
    {
      description:
        "Share ONE item of a private lens with a grantee (pubkey, personal holon id or a group holon with a pinned key). Only that item's content key travels; the rest of the lens stays sealed. The grant survives later edits of the item.",
      inputSchema: { holon: z.string(), lens: z.string(), item: z.string(), grantee: z.string() },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        return ok({ holon: args.holon, lens: args.lens, ...(await grantItem(hs, args.holon, args.lens, args.item, args.grantee)) });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'privacy_revoke_lens',
    {
      description:
        "Take a lens back from a grantee. Forward-only: the lens key AND every item's content key rotate, every item is rewritten sealed under the new keys, and the remaining grantees are re-granted. What the revoked party already read stays read.",
      inputSchema: { holon: z.string(), lens: z.string(), grantee: z.string() },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        return ok({ holon: args.holon, lens: args.lens, ...(await revokeLens(hs, args.holon, args.lens, args.grantee)) });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'privacy_revoke_item',
    {
      description:
        "Take one item back from a grantee. Forward-only: the item's content key rotates and it is rewritten; other grantees of that item are re-granted.",
      inputSchema: { holon: z.string(), lens: z.string(), item: z.string(), grantee: z.string() },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        return ok({ holon: args.holon, lens: args.lens, item: args.item, ...(await revokeItem(hs, args.holon, args.lens, args.item, args.grantee)) });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'privacy_grants_list',
    {
      description: 'The grant ledger of a private lens this identity owns (or of every owned lens of the holon when `lens` is omitted), by grantee pubkey.',
      inputSchema: { holon: z.string(), lens: z.string().optional() },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        return ok({ holon: args.holon, grants: await listGrants(hs, args.holon, args.lens) });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'privacy_grants_accept',
    {
      description:
        'Accept a grant payload that arrived out of band (JSON, the body of a `holons/grant` DM). Grants over the relay are accepted automatically; this is for pasted or relayed ones. The key is validated before it is kept, and the sender must speak for the holon (its key, its founded log or a member) unless `trusted` says the user takes the key anyway.',
      inputSchema: {
        payload: z.string().describe('JSON-encoded grant payload'),
        sender: z.string().optional().describe('Pubkey (hex) that sent the grant'),
        trusted: z.boolean().optional().describe('Skip the sender policy: the user chose to accept this key'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        return ok(await acceptGrant(hs, args.payload, args.sender ?? null, { trusted: !!args.trusted }));
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
