// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// allocation_get / allocation_save / allocation_cascade over a fake
// holosphere: a collective splitting equally between two members, one of
// whom passes part of their share on from their personal holon.
import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { registerFlowsTools } from './flows.js';
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

function fakeDeps(seed: Record<string, Record<string, Record<string, unknown>>> = {}) {
  const db: Record<string, Record<string, Record<string, unknown>>> = { ...seed };
  const hs = {
    get: async (holon: string, lens: string, key?: string) => (key ? (db[`${holon}/${lens}`]?.[key] ?? null) : null),
    getAll: async (holon: string, lens: string) => Object.values(db[`${holon}/${lens}`] ?? {}),
    put: async (holon: string, lens: string, rec: { id?: string | number }) => {
      (db[`${holon}/${lens}`] ??= {})[String(rec.id)] = rec;
      return true;
    },
    getFederation: async () => ({ federated: [] }),
  };
  const deps: ToolDeps = { getHoloSphere: async () => hs, resolveActor: () => ({ id: '7' }) as never };
  return { deps, db };
}

const payload = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);

describe('allocation tools', () => {
  it('saves an equal split merged onto the settings document, and reads it back', async () => {
    const { server, tools } = capture();
    const { deps, db } = fakeDeps({ 'C/settings': { C: { id: 'C', name: 'Collective' } } });
    registerFlowsTools(server, deps);

    const saved = payload(
      await tools.get('allocation_save')!({
        holon: 'C',
        interiorPercent: 100,
        interiorMode: 'custom',
        shares: { u1: 1, u2: 1 },
      }),
    );
    expect(saved.success).toBe(true);
    expect((db['C/settings'].C as any).name).toBe('Collective');
    expect((db['C/settings'].C as any).allocation.shares).toEqual({ u1: 1, u2: 1 });

    const got = payload(await tools.get('allocation_get')!({ holon: 'C', total: 1000, unit: 'EUR' }));
    expect(got.configured).toBe(true);
    expect(got.allocation.interior.map((m: any) => [m.id, m.amount])).toEqual([
      ['u1', 500],
      ['u2', 500],
    ]);
  });

  it('reports an unconfigured holon as such', async () => {
    const { server, tools } = capture();
    const { deps } = fakeDeps();
    registerFlowsTools(server, deps);
    expect(payload(await tools.get('allocation_get')!({ holon: 'nobody' })).configured).toBe(false);
  });

  it("follows a member's share down through their personal holon", async () => {
    const { server, tools } = capture();
    const { deps } = fakeDeps({
      'C/settings': {
        C: { id: 'C', allocation: { interiorPercent: 100, interiorMode: 'custom', shares: { u1: 1, u2: 1 } } },
      },
      'u1/settings': { u1: { id: 'u1', allocation: { interiorPercent: 60, people: { u3: 1 } } } },
    });
    registerFlowsTools(server, deps);

    const out = payload(await tools.get('allocation_cascade')!({ holon: 'C', total: 1000 }));
    expect(out.success).toBe(true);
    expect(out.leaves.u1.amount).toBeCloseTo(300);
    expect(out.leaves.u2.amount).toBeCloseTo(500);
    expect(out.leaves.u3.amount).toBeCloseTo(200);
    expect(out.summary.cycles).toEqual([]);
    expect(out.summary.stuck).toEqual(['u1']);
    const u1 = out.tree.children.find((c: any) => c.id === 'u1');
    expect(u1.children.map((c: any) => [c.id, c.reason])).toEqual([
      ['u3', 'terminal'],
      ['u1', 'retained'],
    ]);

    // On the chain rail nobody deployed a bundle, so nothing cascades.
    const chain = payload(await tools.get('allocation_cascade')!({ holon: 'C', rail: 'chain' }));
    expect(chain.leaves.u1.percentage).toBeCloseTo(50);
    expect(chain.bundles).toEqual({});
  });
});

describe('mint tools', () => {
  /** A fake with the log surface the mints fold reads: append + getLog, unverified. */
  function logDeps(seed: Record<string, Record<string, Record<string, unknown>>> = {}) {
    const { deps, db } = fakeDeps(seed);
    const logs: Record<string, any[]> = {};
    const hs: any = {
      currentPubkey: 'a'.repeat(64),
      get: async (holon: string, lens: string, key?: string) => (key ? (db[`${holon}/${lens}`]?.[key] ?? null) : null),
      getAll: async (holon: string, lens: string) => Object.values(db[`${holon}/${lens}`] ?? {}),
      getAllGlobal: async () => [],
      getFederation: async () => ({ federated: [] }),
      append: async (holon: string, lens: string, item: unknown, opts: { refs?: unknown } = {}) => {
        const id = `${holon}/${lens}/${(logs[`${holon}/${lens}`] ??= []).length + 1}`.padEnd(64, '0');
        const e = { id, pubkey: hs.currentPubkey, created_at: 1_760_000_000 + logs[`${holon}/${lens}`].length, refs: { prev: [], basis: [], attests: [], disputes: [], ...(opts.refs as object) }, item };
        logs[`${holon}/${lens}`].push(e);
        return e;
      },
      getLog: async (holon: string, lens: string) => logs[`${holon}/${lens}`] ?? [],
    };
    return { deps: { ...deps, getHoloSphere: async () => hs } as ToolDeps, db, hs };
  }

  it('records a mint and reads the fund back, with the MCP key as the bootstrap admin', async () => {
    const { server, tools } = capture();
    const { deps, hs } = logDeps({ 'olive/settings': { olive: { id: 'olive', holonPubkey: 'a'.repeat(64) } } });
    registerFlowsTools(server, deps);
    const rec = payload(await tools.get('flow_mint_record')!({ holon: 'olive', amount: 120, unit: 'l', memo: 'first pressing' }));
    expect(rec.success).toBe(true);
    expect(rec.item).toMatchObject({ kind: 'mint', amount: 120, unit: 'L', memo: 'first pressing' });
    const state = payload(await tools.get('flow_mints_state')!({ holon: 'olive' }));
    expect(state.success).toBe(true);
    expect(state.byUnit).toEqual({ L: 120 });
    expect(state.mints[0]).toMatchObject({ status: 'issued', pubkey: hs.currentPubkey });
    expect(state.units).toEqual(['l']);
  });

  it('a mint by a key the holon does not accept is recorded but not counted', async () => {
    const { server, tools } = capture();
    const { deps } = logDeps({ 'olive/settings': { olive: { id: 'olive', holonPubkey: 'b'.repeat(64) } } });
    registerFlowsTools(server, deps);
    await tools.get('flow_mint_record')!({ holon: 'olive', amount: 5, unit: 'L' });
    const state = payload(await tools.get('flow_mints_state')!({ holon: 'olive' }));
    expect(state.byUnit).toEqual({});
    expect(state.mints[0].status).toBe('rejected');
  });
});
