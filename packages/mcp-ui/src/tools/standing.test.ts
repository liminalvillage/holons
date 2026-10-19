// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// standing_* over a fake holosphere that signs appends with one key: the key
// is the holon's bootstrap admin, so its own exit and needs flags count.
import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { randomBytes } from 'node:crypto';
import { registerStandingTools } from './standing.js';
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

// The reducer reads entries, never signatures: a fake log with well-formed
// ids and refs under one key is what `getLog` would hand back.
function fakeDeps() {
  const pk = randomBytes(32).toString('hex');
  const logs = new Map<string, any[]>();
  const log = (holon: string, lens: string) => {
    const k = `${holon}|${lens}`;
    if (!logs.has(k)) logs.set(k, []);
    return logs.get(k)!;
  };
  let clock = 1_760_000_000;
  const list = (v: string | string[] | undefined) => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const hs = {
    currentPubkey: pk,
    async getLog(holon: string, lens: string) {
      return [...log(holon, lens)];
    },
    async append(holon: string, lens: string, item: unknown, { refs }: { refs?: Record<string, string | string[]> } = {}) {
      const event = { id: randomBytes(32).toString('hex'), pubkey: pk, created_at: clock++ };
      log(holon, lens).push({
        ...event,
        refs: { prev: list(refs?.prev), basis: list(refs?.basis), attests: list(refs?.attests), disputes: list(refs?.disputes), other: [] },
        item,
      });
      return event;
    },
    async get(holon: string, lens: string, id: string) {
      return lens === 'settings' && id === holon ? { id: holon, holonPubkey: pk } : null;
    },
    async getAll() {
      return [];
    },
    async getAllGlobal() {
      return [];
    },
    store: { listEventIds: () => [], getEvents: () => [] },
  };
  const deps: ToolDeps = { getHoloSphere: async () => hs, resolveActor: () => ({ id: '7' }) as never };
  return { deps, pk };
}

const payload = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);

describe('standing tools', () => {
  it('records an exit that counts once, a needs flag that self-attests, and reads the standing back', async () => {
    const { server, tools } = capture();
    const { deps } = fakeDeps();
    registerStandingTools(server, deps);
    const party = 'h1'; // the holon key acts for the holon itself

    const exit = payload(await tools.get('standing_exit_record')!({ holon: 'h1', party, memo: 'moving on' }));
    expect(exit.success).toBe(true);
    expect(exit.entry).toMatchObject({ kind: 'exit', party, status: 'accepted', memo: 'moving on' });
    expect(Object.keys(exit.exited)).toEqual([party]);

    const again = payload(await tools.get('standing_exit_record')!({ holon: 'h1', party }));
    expect(again.entry).toMatchObject({ status: 'rejected', reason: 'already-exited' });

    const needs = payload(await tools.get('standing_needs_record')!({ holon: 'h1', party, on: true }));
    expect(needs.entry).toMatchObject({ kind: 'needs', on: true, status: 'accepted' });
    expect(Object.keys(needs.inNeed)).toEqual([party]);

    const off = payload(await tools.get('standing_needs_record')!({ holon: 'h1', party, on: false }));
    expect(off.inNeed).toEqual({});

    const verdict = payload(await tools.get('standing_verdict')!({ holon: 'h1', lens: 'flow_exits', id: exit.id, verdict: 'dispute', reason: 'wait' }));
    expect(verdict.target).toMatchObject({ id: exit.id, status: 'disputed', disputes: 1 });

    // The first exit is held by the dispute, so the second — refused as a
    // repeat until now — counts: an entry counts the moment its reason goes away.
    const state = payload(await tools.get('standing_state')!({ holon: 'h1' }));
    expect(state.exited.h1.id).toBe(again.id);
    expect(state.exits).toHaveLength(2);
    expect(state.needs).toHaveLength(2);
    expect(state.policy.exits.quorum).toBe(0);
    expect(state.policy.needs.quorum).toBe(1);
  });
});
