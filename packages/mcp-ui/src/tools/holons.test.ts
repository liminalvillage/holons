// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The holon tools drive core end to end over a real local instance: found,
// seat by request, keep the list, and the Telegram link handshake with the
// bot's half played by a second key on the same store.
import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { createHoloSphere, signerFromSecretKey } from '@holons/core/holosphere';
import { acceptTelegramLink } from '@holons/core/linking';
import { registerHolonsTools } from './holons.js';
import type { ToolDeps } from './index.js';

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>;

function capture() {
  const tools = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _def: { inputSchema: Record<string, ZodTypeAny> }, handler: Handler) => {
      tools.set(name, handler);
    },
  };
  return { server: server as never, tools };
}
const payload = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);
const key = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const sk = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { sk, pk: signerFromSecretKey(sk).pubkey };
};

describe('holon tools', () => {
  it('create → join request → approve → members; remember → list; offer → (bot accepts) → status → complete → unlink', async () => {
    const me = key();
    const bob = key();
    const bot = key();
    const hs = createHoloSphere({ appName: 'mcp-holons-test', privateKey: me.sk, store: { adapter: 'memory' } });
    const published: Array<{ kind: number }> = [];
    (hs as unknown as { publishNostrEvents: (e: unknown) => void }).publishNostrEvents = (e) => published.push(...((Array.isArray(e) ? e : [e]) as never[]));
    (hs as unknown as { subscribeNostr: () => () => void }).subscribeNostr = () => () => {};
    let secret = me.sk;
    const deps: ToolDeps = { getHoloSphere: async () => hs, resolveActor: () => ({ id: '7' }) as never, getSignerSecret: () => secret };
    const { server, tools } = capture();
    registerHolonsTools(server, deps);

    const created = payload(await tools.get('holon_create')!({ name: 'Orto', first_name: 'Me' }));
    const H = created.holon as string;
    expect(H).toMatch(/^holon_/);
    expect(created.anchor).toBe(me.pk);
    expect(published.map((e) => e.kind)).toEqual(expect.arrayContaining([39000, 39001, 39002]));

    const seated = payload(await tools.get('holon_join_approve')!({ holon: H, pubkey: bob.pk }));
    expect(seated).toMatchObject({ success: true, pubkey: bob.pk, role: 'member' });
    const members = payload(await tools.get('holon_members')!({ holon: H }));
    expect(members.members).toMatchObject({ [me.pk]: 'admin', [bob.pk]: 'member' });
    expect(members.myRole).toBe('admin');

    expect(payload(await tools.get('holon_remember')!({ holon: H, name: 'Orto' })).success).toBe(true);
    expect(payload(await tools.get('holon_list_mine')!({})).holons.map((h: { id: string }) => h.id)).toEqual([H]);

    const offer = payload(await tools.get('holon_telegram_link_offer')!({ holon: H, botUsername: 'TestBot' }));
    expect(offer.urls.group).toContain('t.me/TestBot?startgroup=link_');
    expect(payload(await tools.get('holon_telegram_link_status')!({ holon: H, id: offer.id })).state).toBe('waiting');
    expect(payload(await tools.get('holon_telegram_link_complete')!({ holon: H, id: offer.id })).success).toBe(false);

    // The bot's half.
    await hs.login(bot.sk);
    const T = '-1001234567890';
    const r = await acceptTelegramLink(hs, { holon: H, token: offer.token, chat: { id: T, type: 'supergroup', title: 'Orto chat' }, byUserId: 42 });
    expect(r.ok).toBe(true);
    await hs.login(me.sk);
    secret = me.sk;

    const st = payload(await tools.get('holon_telegram_link_status')!({ holon: H, id: offer.id }));
    expect(st).toMatchObject({ state: 'accepted', chat: T, anchor: bot.pk, title: 'Orto chat' });
    const done = payload(await tools.get('holon_telegram_link_complete')!({ holon: H, id: offer.id }));
    expect(done.record).toMatchObject({ status: 'linked', peer: T, peerAnchor: bot.pk });
    expect(payload(await tools.get('holon_members')!({ holon: H })).members[bot.pk]).toBe('admin');
    expect(payload(await tools.get('holon_telegram_links')!({ holon: H })).links.map((l: { peer: string }) => l.peer)).toEqual([T]);

    const gone = payload(await tools.get('holon_telegram_unlink')!({ holon: H, id: offer.id }));
    expect(gone.record.status).toBe('unlinked');
    expect(payload(await tools.get('holon_members')!({ holon: H })).members[bot.pk]).toBeUndefined();
    await hs.close();
  });
});
