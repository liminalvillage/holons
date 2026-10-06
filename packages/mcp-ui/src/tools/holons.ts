// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Thin MCP wrappers around @holons/core/holons and @holons/core/linking:
// founding a holon with this instance's key, seating keys (NIP-29 shaped
// join requests), the holons this key keeps, and the challenge–response
// link to a Telegram chat. Every write is signed by the MCP key; it counts
// where that key is seated (an admin, for seating and linking).

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { signerFromSecretKey } from '@holons/core/holosphere';
import {
  approveJoin,
  createHolon,
  forgetHolon,
  leaveHolon,
  listJoinRequests,
  myHolons,
  rememberHolon,
  removeSeat,
  requestToJoin,
} from '@holons/core/holons';
import {
  completeTelegramLink,
  federateLinkedChat,
  linkedTelegramChats,
  offerTelegramLink,
  readLinkAccept,
  unfederateLinkedChat,
  unlinkTelegram,
} from '@holons/core/linking';
import { readHolonClaim, telegramDeepLinks } from '@holons/core/onboarding';
import { addHolonMember, holonMembers, myHolonRole, removeHolonMember, syncFoundingAuthority } from '@holons/core/protocol';
import type { ToolDeps } from './index.js';
import { namesFor } from './names.js';

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string, extra?: Record<string, unknown>) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message, ...(extra ?? {}) }, null, 2) }],
  };
}

const roleEnum = z.enum(['member', 'admin']);
const DEFAULT_BOT = 'HolonsBot';

export function registerHolonsTools(server: McpServer, deps: ToolDeps): void {
  const signerOf = () => {
    const secret = deps.getSignerSecret?.();
    return secret ? signerFromSecretKey(secret) : null;
  };
  const opts = (hs: any) => ({ appName: (hs.appname ?? hs.appName ?? 'Holons') as string });

  server.registerTool(
    'holon_create',
    {
      description: 'Found a new holon with this MCP key: mints a holon_… id, signs the genesis of its member log (this key is the first admin), writes its settings, publishes its NIP-29 state. Not a Telegram chat: nothing leaves the relays.',
      inputSchema: { name: z.string().optional(), first_name: z.string().optional().describe('A profile for the founder, when given.'), username: z.string().optional() },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const signer = signerOf();
        if (!signer) return fail('No signing secret configured (HOLOSPHERE_NSEC).');
        const profile = args.first_name || args.username ? { first_name: args.first_name, username: args.username } : undefined;
        const r = await createHolon(hs, signer, { ...opts(hs), name: args.name, profile });
        return ok({ success: true, ...r });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'holon_members',
    {
      description: 'The seated keys of a holon (pubkey → admin|member) from its signed member log, who founds it, and this MCP key\'s own role.',
      inputSchema: { holon: z.string() },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const founding = await syncFoundingAuthority(hs, args.holon);
        const members = Object.fromEntries(await holonMembers(hs, args.holon));
        const names = await namesFor(hs, args.holon, Object.keys(members));
        return ok({ holon: args.holon, founding, members, names, myPubkey: hs.currentPubkey, myRole: await myHolonRole(hs, args.holon) });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  const seat = async (args: { holon: string; key: string; role?: 'member' | 'admin' }) => {
    const hs = await deps.getHoloSphere();
    const signer = signerOf();
    const role = args.role ?? 'member';
    const pub = signer ? await approveJoin(hs, args.holon, args.key, signer, { ...opts(hs), role }) : await addHolonMember(hs, args.holon, args.key, role);
    return ok({ success: true, holon: args.holon, pubkey: pub, role });
  };
  server.registerTool(
    'holon_member_add',
    { description: 'Seat a key (npub or hex) in a holon as member or admin. Counts only when this MCP key is an admin of the holon. Publishes the NIP-29 put-user and refreshed group state.', inputSchema: { holon: z.string(), key: z.string(), role: roleEnum.optional() } },
    async (args) => {
      try {
        return await seat(args as never);
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
  server.registerTool(
    'holon_join_approve',
    { description: 'Approve a join request: the same as holon_member_add for the requesting pubkey.', inputSchema: { holon: z.string(), pubkey: z.string(), role: roleEnum.optional() } },
    async (args) => {
      try {
        return await seat({ holon: args.holon as string, key: args.pubkey as string, role: args.role as never });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
  server.registerTool(
    'holon_member_remove',
    { description: 'Unseat a key from a holon (admins only; never this key itself). Publishes the NIP-29 remove-user and refreshed state.', inputSchema: { holon: z.string(), key: z.string() } },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const signer = signerOf();
        const pub = signer ? await removeSeat(hs, args.holon, args.key, signer, opts(hs)) : await removeHolonMember(hs, args.holon, args.key);
        return ok({ success: true, holon: args.holon, pubkey: pub });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'holon_join_request',
    { description: 'Ask to join a holon as this MCP key: a NIP-29 kind-9021 request carrying a display name. An admin seats the key with holon_join_approve.', inputSchema: { holon: z.string(), name: z.string().optional() } },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const signer = signerOf();
        if (!signer) return fail('No signing secret configured (HOLOSPHERE_NSEC).');
        const ev = requestToJoin(hs, args.holon, signer, { ...opts(hs), reason: args.name });
        return ok({ success: true, holon: args.holon, pubkey: ev.pubkey, eventId: ev.id });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
  server.registerTool(
    'holon_join_requests',
    { description: 'The pending join requests of a holon (verified kind-9021 events, newest per key, seated keys left out), collected over a short window.', inputSchema: { holon: z.string(), windowMs: z.number().int().min(100).max(10000).optional() } },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const requests = await listJoinRequests(hs, args.holon, { windowMs: args.windowMs });
        return ok({ holon: args.holon, requests, names: await namesFor(hs, args.holon, requests.map((r) => r.pubkey)) });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
  server.registerTool(
    'holon_leave',
    { description: 'Leave a holon as this MCP key: a NIP-29 kind-9022. An admin removes the seat.', inputSchema: { holon: z.string() } },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const signer = signerOf();
        if (!signer) return fail('No signing secret configured (HOLOSPHERE_NSEC).');
        const ev = leaveHolon(hs, args.holon, signer, opts(hs));
        return ok({ success: true, holon: args.holon, eventId: ev.id });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'holon_list_mine',
    { description: 'The holons this MCP key keeps in its own holon (`holons` lens), most recent first.', inputSchema: {} },
    async () => {
      try {
        const hs = await deps.getHoloSphere();
        return ok({ pubkey: hs.currentPubkey, holons: await myHolons(hs, hs.currentPubkey) });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
  server.registerTool(
    'holon_remember',
    { description: 'Remember (or forget) a holon in this key\'s own list, so every surface signed in with it sees the same holons.', inputSchema: { holon: z.string(), name: z.string().optional(), forget: z.boolean().optional() } },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        if (args.forget) {
          await forgetHolon(hs, hs.currentPubkey, args.holon);
          return ok({ success: true, forgotten: args.holon });
        }
        return ok({ success: true, remembered: await rememberHolon(hs, hs.currentPubkey, { id: args.holon, name: args.name }) });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'holon_telegram_link_offer',
    {
      description: 'Offer to link a Telegram chat to a holon this key admins. Returns the one-time token, the record id, and the Telegram deep links (`?startgroup=` for a group, `?start=` for a private chat) a chat ADMIN must tap. Then poll holon_telegram_link_status and complete with holon_telegram_link_complete.',
      inputSchema: { holon: z.string(), botUsername: z.string().optional().describe(`The bot the deep links point at (default ${DEFAULT_BOT}).`) },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const offer = await offerTelegramLink(hs, args.holon);
        return ok({ success: true, holon: args.holon, id: offer.id, token: offer.token, payload: offer.payload, urls: telegramDeepLinks(args.botUsername || DEFAULT_BOT, offer.payload) });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
  const status = async (holon: string, id: string) => {
    const hs = await deps.getHoloSphere();
    const claim = await readHolonClaim(hs, id);
    if (!claim) return { holon, id, state: 'waiting' as const };
    const accept = await readLinkAccept(hs, { holon, id, chat: claim.holon });
    if (!accept) return { holon, id, state: 'claimed-unverified' as const, chat: claim.holon };
    return { holon, id, state: 'accepted' as const, chat: accept.chat, anchor: accept.anchor, title: accept.record.chat?.title, record: accept.record };
  };
  server.registerTool(
    'holon_telegram_link_status',
    { description: 'Where a link offer stands: waiting (no chat answered), claimed-unverified (a chat answered but its signed acceptance is not there yet), or accepted (the chat, its anchor key and title — ready to complete).', inputSchema: { holon: z.string(), id: z.string() } },
    async (args) => {
      try {
        return ok(await status(args.holon, args.id));
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
  server.registerTool(
    'holon_telegram_link_complete',
    { description: 'Complete an accepted link: mark it linked, seat the chat\'s key (the bot) as an admin of the holon, and federate every board lens both ways. Check the chat title with holon_telegram_link_status first.', inputSchema: { holon: z.string(), id: z.string() } },
    async (args) => {
      try {
        const st = await status(args.holon, args.id);
        if (st.state !== 'accepted') return fail(`The link is ${st.state}; nothing to complete yet.`, st);
        const hs = await deps.getHoloSphere();
        const name = st.title || st.chat;
        const record = await completeTelegramLink(hs, { holon: args.holon, id: args.id, chat: st.chat, anchor: st.anchor, name });
        await federateLinkedChat(hs, args.holon, st.chat, name).catch(() => {});
        return ok({ success: true, record });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
  server.registerTool(
    'holon_telegram_links',
    { description: 'The Telegram chats linked to a holon.', inputSchema: { holon: z.string() } },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        return ok({ holon: args.holon, links: await linkedTelegramChats(hs, args.holon) });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
  server.registerTool(
    'holon_telegram_unlink',
    { description: 'Drop a Telegram link: the record goes unlinked, the bot key is unseated, the federation removed.', inputSchema: { holon: z.string(), id: z.string() } },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const gone = await unlinkTelegram(hs, args.holon, args.id);
        if (!gone) return fail('No link of ours to drop.');
        if (gone.peer) await unfederateLinkedChat(hs, args.holon, gone.peer).catch(() => {});
        return ok({ success: true, record: gone });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
