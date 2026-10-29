// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The holon tools drive core end to end over a real local instance: found,
// seat by request, keep the list, and the Telegram link handshake with the
// bot's half played by a second key on the same store.
import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { createHoloSphere, signerFromSecretKey } from '@holons/core/holosphere';
import { parseJoinRequest, requestToJoin } from '@holons/core/holons';
import { acceptTelegramLink } from '@holons/core/linking';
import { startOnboarding } from '@holons/core/onboarding';
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
    // Every key named: the founder by the profile holon_create wrote, Bob in the short form.
    expect(members.names[me.pk]).toBe('Me');
    expect(members.names[bob.pk]).toMatch(/^npub1.*…/);

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

  it('onboarding: set the steps, see who walks them, confirm the call, link at the end', async () => {
    const me = key();
    const ada = key();
    const hs = createHoloSphere({ appName: 'mcp-onboarding-test', privateKey: me.sk, store: { adapter: 'memory' } });
    (hs as unknown as { publishNostrEvents: () => void }).publishNostrEvents = () => {};
    (hs as unknown as { subscribeNostr: () => () => void }).subscribeNostr = () => () => {};
    const deps: ToolDeps = { getHoloSphere: async () => hs, resolveActor: () => ({ id: '7' }) as never, getSignerSecret: () => me.sk };
    const { server, tools } = capture();
    registerHolonsTools(server, deps);
    const H = payload(await tools.get('holon_create')!({ name: 'Orto' })).holon as string;

    const saved = payload(
      await tools.get('onboarding_config_save')!({ holon: H, enabled: true, steps: [{ title: 'Call', cards: [{ title: 'Onboarding call', confirm: 'admin' }] }] }),
    );
    expect(saved.config).toEqual({ enabled: true, steps: [{ id: 'call', title: 'Call', cards: [{ id: 'onboarding_call', title: 'Onboarding call', confirm: 'admin' }] }] });
    // Switching it off keeps the steps.
    expect(payload(await tools.get('onboarding_config_save')!({ holon: H, enabled: false })).config.steps).toHaveLength(1);
    await tools.get('onboarding_config_save')!({ holon: H, enabled: true });

    const req = parseJoinRequest(requestToJoin(hs, H, signerFromSecretKey(ada.sk), { appName: 'mcp-onboarding-test', reason: 'Ada' }))!;
    await startOnboarding(hs, H, req, { home: '4242', appName: 'mcp-onboarding-test' });
    expect(payload(await tools.get('onboarding_get')!({ holon: H })).onboarding).toEqual([{ pubkey: ada.pk, name: 'Ada', step: 'call', home: '4242' }]);

    expect((await tools.get('onboarding_confirm')!({ holon: H, pubkey: ada.pk, step: 'call', card: 'nope' })).isError).toBe(true);
    const done = payload(await tools.get('onboarding_confirm')!({ holon: H, pubkey: ada.pk, step: 'call', card: 'onboarding_call' }));
    expect(done).toMatchObject({ success: true, linked: true, view: { finished: true, status: 'approved' } });
    expect(payload(await tools.get('holon_members')!({ holon: H })).members[ada.pk]).toBe('member');
    await hs.close();
  });
});
