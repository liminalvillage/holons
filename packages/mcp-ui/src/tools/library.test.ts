// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// library_return on someone else's booking: only an admin of the holon
// (`library.manage`) may end it, and the result names the borrower — the one
// to refund — not the admin who pressed Return.
import { describe, expect, it } from 'vitest';
import { createHoloSphere, signerFromSecretKey } from '@holons/core/holosphere';
import { registerLibraryTools } from './library.js';
import type { ToolDeps } from './index.js';

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>;

function capture() {
  const tools = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _def: unknown, handler: Handler) => {
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

function toolsFor(hs: Host, actorId: string) {
  const deps = {
    getHoloSphere: async () => hs,
    resolveActor: () => ({ id: actorId, username: actorId }),
  } as unknown as ToolDeps;
  const { server, tools } = capture();
  registerLibraryTools(server, deps);
  return tools;
}

const ymd = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('library_return on behalf', () => {
  it("an admin returns a member's overdue item; a plain member is refused", async () => {
    const alice = key(), mia = key(), bot = key();
    const mk = (sk: string) =>
      createHoloSphere({ appName: 'mcp-libret-test', privateKey: sk, store: { adapter: 'memory' } }) as Host;
    const a = mk(alice.sk), m = mk(mia.sk), o = mk(bot.sk);
    await Promise.all([a.ready(), m.ready(), o.ready()]);
    const H = '-1881';
    await o.foundHolon(H, { at: 1_700_000_000 });
    await o.addMember(H, alice.pk, 'admin', { at: 1_700_000_001 });
    await o.addMember(H, mia.pk, 'member', { at: 1_700_000_001 });
    share(a, m, o);

    await a.put(H, 'library', {
      id: 'drill',
      type: 'tool',
      createdBy: 'alice',
      value: 5,
      bookings: [{ id: 'b1', start: ymd(-9), end: ymd(-2), borrowerId: '77', borrower: 'ana', created: '2026-01-01T00:00:00.000Z' }],
    });
    share(a, m, o);

    // Not her booking, no admin claim: core refuses.
    const plain = payload(await toolsFor(m, 'mia').get('library_return')!({ holon: H, itemId: 'drill' }));
    expect(plain).toMatchObject({ success: false, error: 'forbidden' });

    // Claiming admin without being one: the gate refuses before any write.
    const claimed = payload(
      await toolsFor(m, 'mia').get('library_return')!({ holon: H, itemId: 'drill', onBehalf: true }),
    );
    expect(claimed.success).toBe(false);
    expect(claimed.error).toMatch(/admin/);

    // The admin ends Ana's booking; the refund belongs to Ana.
    const done = payload(
      await toolsFor(a, 'alice').get('library_return')!({ holon: H, itemId: 'drill', onBehalf: true }),
    );
    expect(done).toMatchObject({ success: true, onBehalf: true, borrower: { id: '77' } });
    expect(done.booking.id).toBe('b1');
    expect(done.item.bookings).toEqual([]);
  });
});
