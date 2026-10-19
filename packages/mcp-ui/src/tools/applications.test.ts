// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// fund_apply / fund_applications / fund_application_verdict over a real
// in-memory holosphere: ask, list, approve onto a ring, decline, close.
import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { createHoloSphere } from '@holons/core/holosphere';
import { readZoneAssignments } from '@holons/core/flows';
import { registerApplicationsTools } from './applications.js';
import type { ToolDeps } from './index.js';

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>;

async function setup() {
  const hs: any = createHoloSphere({ appName: 'mcp-applications-test', privateKey: crypto.getRandomValues(new Uint8Array(32)), store: { adapter: 'memory' } });
  await hs.ready();
  await hs.foundHolon('holon_fund', {});
  hs._readAuthority?.invalidate();
  await hs.put('holon_fund', 'settings', { id: 'holon_fund', allocation: { interiorPercent: 0, steepness: 50, nzones: 2 } });
  const tools = new Map<string, Handler>();
  const server = { registerTool: (name: string, _def: { inputSchema: Record<string, ZodTypeAny> }, handler: Handler) => tools.set(name, handler) };
  registerApplicationsTools(server as never, { getHoloSphere: async () => hs, resolveActor: () => ({ id: '7' }) as never } as ToolDeps);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await tools.get(name)!(args);
    return { ...JSON.parse(r.content[0].text), failed: !!r.isError };
  };
  return { hs, call };
}

describe('fund application tools', () => {
  it('asks, lists, approves onto the outermost ring', async () => {
    const { hs, call } = await setup();
    const asked = await call('fund_apply', { fund: 'holon_fund', party: 'holon_alder', name: 'Alder', note: 'trees' });
    expect(asked).toMatchObject({ failed: false, success: true, withdrawn: false });
    const listed = await call('fund_applications', { fund: 'holon_fund', status: 'pending' });
    expect(listed).toMatchObject({ open: true, pending: 1 });
    expect(listed.applications[0]).toMatchObject({ id: asked.id, party: 'holon_alder', name: 'Alder', note: 'trees', status: 'pending' });

    const yes = await call('fund_application_verdict', { fund: 'holon_fund', applicationId: asked.id, verdict: 'approve' });
    expect(yes).toMatchObject({ failed: false, party: 'holon_alder', kind: 'holon', ring: 2, placed: true });
    expect(readZoneAssignments(await hs.get('holon_fund', 'settings', 'holon_fund'))).toEqual({ holon_alder: 2 });
    expect((await call('fund_applications', { fund: 'holon_fund' })).applications[0].status).toBe('approved');
  });

  it('declines with a reason, takes an ask back, and closes the fund', async () => {
    const { call } = await setup();
    const a = await call('fund_apply', { fund: 'holon_fund', party: 'holon_birch' });
    await call('fund_application_verdict', { fund: 'holon_fund', applicationId: a.id, verdict: 'decline', reason: 'later' });
    expect((await call('fund_applications', { fund: 'holon_fund' })).applications[0]).toMatchObject({ status: 'declined', reason: 'later' });

    await call('fund_apply', { fund: 'holon_fund', party: 'holon_cedar' });
    expect(await call('fund_apply', { fund: 'holon_fund', party: 'holon_cedar', withdraw: true })).toMatchObject({ withdrawn: true });

    expect(await call('fund_applications', { fund: 'holon_fund', open: false })).toMatchObject({ open: false });
    expect(await call('fund_apply', { fund: 'holon_fund', party: 'holon_dogwood' })).toMatchObject({ failed: true });
    expect(await call('fund_application_verdict', { fund: 'holon_fund', applicationId: 'nope', verdict: 'approve' })).toMatchObject({ failed: true });
  });
});
