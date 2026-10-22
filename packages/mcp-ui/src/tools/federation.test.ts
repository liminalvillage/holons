// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Federation link tools over two real local instances — one per admin, the
// events copied between them as a shared relay would: A's admin links and B
// is asked; B's admin sees the request and accepts.
import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { createHoloSphere, signerFromSecretKey } from '@holons/core/holosphere';
import { registerFederationTools } from './federation.js';
import { registerSettingsTools } from './settings.js';
import type { ToolDeps } from './index.js';

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>;

function capture() {
  const tools = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _def: { inputSchema: Record<string, ZodTypeAny> }, handler: Handler) => {
      tools.set(name, handler);
    },
    tool: (name: string, ...rest: unknown[]) => {
      tools.set(name, rest[rest.length - 1] as Handler);
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

type Host = ReturnType<typeof createHoloSphere> & {
  store: { exportEvents(): unknown[]; apply(e: unknown, o?: object): unknown };
  _readAuthority?: { invalidate(): void };
};

function share(...all: Host[]) {
  const events = all.flatMap((h) => h.store.exportEvents());
  for (const h of all) {
    for (const e of events) h.store.apply(e, { origin: 'remote', verify: false });
    h._readAuthority?.invalidate();
  }
}

function toolsFor(hs: Host) {
  const deps: ToolDeps = { getHoloSphere: async () => hs, resolveActor: () => ({ id: '1' }) as never } as ToolDeps;
  const { server, tools } = capture();
  registerFederationTools(server, deps);
  registerSettingsTools(server, deps);
  return tools;
}

describe('federation request tools', () => {
  it("link → B asked → B lists and accepts → the lane is agreed; a stranger's answer is refused", async () => {
    const alice = key(), bob = key(), bot = key(), eve = key();
    const mk = (sk: string) => createHoloSphere({ appName: 'mcp-fedreq-test', privateKey: sk, store: { adapter: 'memory' } }) as Host;
    const a = mk(alice.sk), b = mk(bob.sk), o = mk(bot.sk), e = mk(eve.sk);
    await Promise.all([a.ready(), b.ready(), o.ready(), e.ready()]);
    const A = '-1771', B = '-1772';
    await o.foundHolon(A, { at: 1_700_000_000 });
    await o.foundHolon(B, { at: 1_700_000_000 });
    await o.addMember(A, alice.pk, 'admin', { at: 1_700_000_001 });
    await o.addMember(B, bob.pk, 'admin', { at: 1_700_000_001 });
    share(a, b, o, e);

    const linked = payload(
      await toolsFor(a).get('federation_link_add')!({ holon: A, target: JSON.stringify({ targetId: B, inbound: ['library'] }) }),
    );
    expect(linked.outcome).toEqual({ self: 'linked', partner: 'requested' });
    expect(linked.note).toMatch(/asked/);
    share(a, b, o, e);

    const tb = toolsFor(b);
    const listed = payload(await tb.get('federation_requests')!({ holon: B, partner: A }));
    expect(listed.requests).toHaveLength(1);
    expect(listed.requests[0]).toMatchObject({ from: A, kind: 'link', outbound: ['library'] });
    expect(listed.link.lanes.library).toEqual({ receive: 'off', send: 'offered' });

    const refused = await toolsFor(e).get('federation_request_answer')!({ holon: B, from: A, decision: 'accept' });
    expect(refused.isError).toBe(true);

    const answered = payload(await tb.get('federation_request_answer')!({ holon: B, from: A, decision: 'accept' }));
    expect(answered.request.status).toBe('accepted');
    share(a, b, o, e);

    const after = payload(await toolsFor(a).get('federation_requests')!({ holon: A, partner: B }));
    expect(after.link.lanes.library).toEqual({ receive: 'agreed', send: 'off' });
    expect(payload(await tb.get('federation_requests')!({ holon: B })).requests).toEqual([]);

    const missing = await tb.get('federation_request_answer')!({ holon: B, from: '-9', decision: 'decline' });
    expect(missing.isError).toBe(true);
  });
});
