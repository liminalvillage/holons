// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// flow_graph_* over a fake holosphere holding a Pot, a fund, a project and a
// person: a dry run writes nothing, a publish can be read back by party.
import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { registerFlowgraphTools } from './flowgraph.js';
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

const WALLET = '0x' + 'a'.repeat(40);

function fakeDeps() {
  const settings: Record<string, any> = {
    holon_pot: { name: 'The Pot', allocation: { interiorPercent: 100, interiorMode: 'custom', shares: { holon_fund: 1, holon_proj: 1 } } },
    holon_fund: { name: 'A Fund', allocation: { interiorPercent: 0, steepness: 50, nzones: 1, zones: { holon_proj: 1 } } },
    holon_proj: { name: 'A Project', allocation: { interiorPercent: 100, interiorMode: 'custom', shares: { '111': 1 } } },
    '111': { name: 'Ada', payout: { address: WALLET } },
  };
  const lens: Record<string, any> = {};
  const hs = {
    lens,
    async get(holon: string, l: string) {
      return l === 'settings' ? (settings[holon] ?? null) : null;
    },
    async getFederation(holon: string) {
      return holon === 'holon_fund' ? { federated: ['holon_proj'] } : { federated: [] };
    },
    async getAll(_holon: string, l: string) {
      return l === 'flow_graph' ? Object.values(lens) : [];
    },
    async put(_holon: string, _l: string, data: any) {
      lens[data.id] = structuredClone(data);
      return true;
    },
    async delete(_holon: string, _l: string, key: string) {
      delete lens[key];
      return true;
    },
  };
  const deps: ToolDeps = { getHoloSphere: async () => hs, resolveActor: () => ({ id: '7' }) as never };
  return { deps, hs };
}

const payload = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);

describe('flow graph tools', () => {
  it('dry-runs by default, publishes on write, and answers for a party by id or wallet', async () => {
    const { server, tools } = capture();
    const { deps, hs } = fakeDeps();
    registerFlowgraphTools(server, deps);
    const publish = tools.get('flow_graph_publish')!;
    const get = tools.get('flow_graph_get')!;

    expect(payload(await get({ holon: 'holon_pot' }))).toMatchObject({ published: false, reason: 'missing' });

    const dry = payload(await publish({ holon: 'holon_pot', standing: false }));
    expect(dry).toMatchObject({ written: false, complete: true, nodes: 4, links: 4, kinds: { pot: 1, fund: 1, project: 1, person: 1 }, withPayout: 1 });
    expect(dry.parts.count).toBe(1);
    expect(Object.keys(hs.lens)).toEqual([]);

    const wrote = payload(await publish({ holon: 'holon_pot', standing: false, write: true }));
    expect(wrote.written).toBe(true);
    expect(Object.keys(hs.lens).sort()).toEqual(['head', 'p0']);

    expect(payload(await get({ holon: 'holon_pot' }))).toMatchObject({ published: true, nodes: 4, gen: wrote.gen });

    const ada = payload(await get({ holon: 'holon_pot', party: WALLET.toUpperCase().replace('0X', '0x') }));
    expect(ada.resolved).toEqual({ id: '111', via: 'address' });
    expect(ada.node).toMatchObject({ kind: 'person', label: 'Ada', share: 100 });
    expect(ada.seatedBy.map((s: { holon: string }) => s.holon)).toEqual(['holon_proj']);
    expect(ada.upstream.map((r: { id: string }) => r.id).sort()).toEqual(['holon_fund', 'holon_pot', 'holon_proj']);

    const project = payload(await get({ holon: 'holon_pot', party: 'holon_proj' }));
    expect(project.memberships.map((r: { id: string }) => r.id).sort()).toEqual(['holon_fund', 'holon_pot']);
    expect(project.paysOn).toHaveLength(1);

    const unknown = await get({ holon: 'holon_pot', party: 'holon_nobody' });
    expect(unknown.isError).toBe(true);
  });
});
