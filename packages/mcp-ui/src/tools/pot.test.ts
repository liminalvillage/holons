// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// pot_* over a fake holosphere: a grove with a Pot splitting between a
// location and the collectors, who pass a third on to a picker.
import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { randomBytes } from 'node:crypto';
import { registerPotTools } from './pot.js';
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

const GROVE = 'grove';
const LIMINAL = '-100';
const COLLECTORS = '-300';
const PICKER = 'pia';
const EVO = '0x' + 'e'.repeat(40);
const POT = '0x' + '9'.repeat(40);
// The fold trusts the store's verification: an entry needs an id, a pubkey
// and refs, not a real signature.
const pk = randomBytes(32).toString('hex');

function fakeDeps() {
  const db: Record<string, Record<string, any>> = {
    [`${GROVE}/settings`]: {
      [GROVE]: {
        id: GROVE,
        holonPubkey: pk,
        allocation: { interiorPercent: 100, steepness: 50, nzones: 1, interiorMode: 'custom', shares: { [LIMINAL]: 1, [COLLECTORS]: 1 } },
      },
    },
    [`${COLLECTORS}/settings`]: {
      [COLLECTORS]: { id: COLLECTORS, allocation: { interiorPercent: 100, steepness: 50, nzones: 1, interiorMode: 'custom', shares: { [COLLECTORS]: 2, [PICKER]: 1 } } },
    },
    [`${PICKER}/settings`]: { [PICKER]: { id: PICKER, payout: { address: '0x' + 'a'.repeat(40) } } },
  };
  const logs: Record<string, any[]> = {};
  const hs = {
    currentPubkey: pk,
    get: async (holon: string, lens: string, key?: string) => (key ? (db[`${holon}/${lens}`]?.[key] ?? null) : null),
    getAll: async (holon: string, lens: string) => Object.values(db[`${holon}/${lens}`] ?? {}),
    getAllGlobal: async () => [],
    put: async (holon: string, lens: string, rec: { id?: string | number }) => {
      (db[`${holon}/${lens}`] ??= {})[String(rec.id)] = rec;
      return true;
    },
    getLog: async (holon: string, lens: string) => logs[`${holon}/${lens}`] ?? [],
    append: async (holon: string, lens: string, item: Record<string, unknown>, opts?: { refs?: Record<string, string | string[]> }) => {
      const refs = { prev: [] as string[], basis: [] as string[], attests: [] as string[], disputes: [] as string[], other: [] as string[] };
      for (const [marker, v] of Object.entries(opts?.refs ?? {})) {
        for (const id of Array.isArray(v) ? v : [v]) if (id) (refs[marker as keyof typeof refs] ?? refs.other).push(String(id));
      }
      const event = { id: randomBytes(32).toString('hex'), pubkey: pk, created_at: Math.floor(Date.now() / 1000) + (logs[`${holon}/${lens}`]?.length ?? 0) };
      (logs[`${holon}/${lens}`] ??= []).push({ ...event, refs, item });
      return event;
    },
    getFederation: async () => ({ federated: [] }),
  };
  const deps: ToolDeps = { getHoloSphere: async () => hs, resolveActor: () => ({ id: '7' }) as never };
  return { deps, db, logs };
}

const payload = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);

describe('pot tools', () => {
  it('records the Pot, cuts and publishes a table, hands back the commitment and a collect', async () => {
    const { server, tools } = capture();
    const { deps, db } = fakeDeps();
    registerPotTools(server, deps);

    const rec = payload(await tools.get('pot_record_set')!({ holon: GROVE, address: POT, chainId: 11155111, challenge: 259200 }));
    if (!rec.success) throw new Error(JSON.stringify(rec));
    expect(rec.pot).toMatchObject({ address: POT, chainId: 11155111, challenge: 259200 });
    expect((db[`${GROVE}/settings`][GROVE] as any).allocation).toBeTruthy(); // merged, not replaced

    const preview = payload(await tools.get('pot_rights_cut')!({ holon: GROVE, received: { [EVO]: '900' }, epoch: 84 }));
    expect(preview.complete).toBe(true);
    expect(preview.published).toBeNull();
    expect(preview.table.rows.find((r: any) => r.party === PICKER)).toMatchObject({ to: '0x' + 'a'.repeat(40), token: EVO, cumulative: '150' });

    const published = payload(await tools.get('pot_rights_cut')!({ holon: GROVE, received: { [EVO]: '900' }, epoch: 84, publish: true }));
    expect(published.published.id).toMatch(/^[0-9a-f]{64}$/);

    const state = payload(await tools.get('pot_rights_state')!({ holon: GROVE }));
    expect(state.latest).toMatchObject({ id: published.published.id, epoch: 84, status: 'committed' });
    expect(state.signatures).toEqual([]);

    const c = payload(await tools.get('pot_rights_commitment')!({ holon: GROVE }));
    expect(c.domain).toEqual({ name: 'Pot', version: '1', chainId: 11155111, verifyingContract: POT });
    expect(c.message).toMatchObject({ epoch: '84', tableRef: '0x' + published.published.id, tokens: [EVO], totals: ['900'] });
    expect(c.postRootArgs[5]).toEqual([]);

    const signed = payload(
      await tools.get('pot_rights_sign_record')!({ holon: GROVE, tableId: published.published.id, signer: '0x' + 'f'.repeat(40), signature: '0x' + '1'.repeat(130) }),
    );
    expect(signed.success).toBe(true);
    const c2 = payload(await tools.get('pot_rights_commitment')!({ holon: GROVE }));
    expect(c2.signatures).toEqual([{ signer: '0x' + 'f'.repeat(40), signature: '0x' + '1'.repeat(130), pubkey: pk }]);
    expect(c2.postRootArgs[5]).toEqual(['0x' + '1'.repeat(130)]);

    const collect = payload(await tools.get('pot_collect_args')!({ holon: GROVE, party: PICKER, token: EVO }));
    expect(collect.args).toMatchObject({ partyId: PICKER, to: '0x' + 'a'.repeat(40), token: EVO, cumulative: '150' });
    expect(collect.argList[4].length).toBeGreaterThan(0);
    const nobody = payload(await tools.get('pot_collect_args')!({ holon: GROVE, party: COLLECTORS, token: EVO }));
    expect(nobody.args).toBeNull(); // no payout address yet

    const pay = payload(await tools.get('pot_payout_address')!({ party: COLLECTORS, address: '0x' + 'c'.repeat(40) }));
    expect(pay.address).toBe('0x' + 'c'.repeat(40));
    const next = payload(await tools.get('pot_rights_cut')!({ holon: GROVE, received: { [EVO]: '1200' }, epoch: 85 }));
    expect(next.table.rows.find((r: any) => r.party === COLLECTORS)).toMatchObject({ to: '0x' + 'c'.repeat(40), cumulative: '400' });
  });

  it('refuses to publish a table the walk could not complete, and a holon with no Pot', async () => {
    const { server, tools } = capture();
    const { deps } = fakeDeps();
    registerPotTools(server, deps);
    const none = await tools.get('pot_rights_cut')!({ holon: GROVE, received: { [EVO]: '900' } });
    expect(none.isError).toBe(true);
    await tools.get('pot_record_set')!({ holon: GROVE, address: POT, chainId: 1 });
    await tools.get('pot_rights_cut')!({ holon: GROVE, received: { [EVO]: '900' }, epoch: 84, publish: true });
    // the same epoch again does not advance: refused, with the problem named
    const bad = await tools.get('pot_rights_cut')!({ holon: GROVE, received: { [EVO]: '1000' }, epoch: 84, publish: true });
    expect(bad.isError).toBe(true);
    expect(payload(bad).problems[0]).toMatch(/not after/);
  });
});
