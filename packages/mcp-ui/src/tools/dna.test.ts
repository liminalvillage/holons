// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The DNA tools over a real local instance: an in-memory store, publishing
// stubbed — nothing here reaches a relay.
import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { createHoloSphere, signerFromSecretKey } from '@holons/core/holosphere';
import { parseJoinRequest } from '@holons/core/holons';
import { dnaHash, readGenes, geneHash } from '@holons/core/dna';
import { registerDnaTools, validatedFront } from './dna.js';
import { registerHolonsTools } from './holons.js';
import { registerAllTools, type ToolDeps } from './index.js';

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>;

function capture() {
  const dups: string[] = [];
  const tools = new Map<string, { def: { inputSchema?: Record<string, ZodTypeAny> }; run: Handler }>();
  const server = {
    // A real McpServer throws when a name is registered twice (registerAllTools then swallows
    // it and drops the rest of the domain), so the fake must not hide a collision.
    registerTool: (name: string, def: { inputSchema?: Record<string, ZodTypeAny> }, run: Handler) => {
      if (tools.has(name)) {
        dups.push(name);
        throw new Error(`Tool ${name} is already registered`);
      }
      tools.set(name, { def, run });
    },
    tool: (name: string, ...rest: unknown[]) => {
      if (tools.has(name)) {
        dups.push(name);
        throw new Error(`Tool ${name} is already registered`);
      }
      tools.set(name, { def: {}, run: rest[rest.length - 1] as Handler });
    },
  };
  return { server: server as never, tools, dups };
}
const payload = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);
const key = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const sk = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { sk, pk: signerFromSecretKey(sk).pubkey };
};

// The tools this change retires: the chromosome/sequence set and the old join request.
const RETIRED = [
  'dna_validate',
  'chromosome_add',
  'chromosome_remove',
  'chromosome_library_get',
  'chromosome_library_seed',
  'dna_sequence_get',
  'dna_sequence_save',
  'dna_chromosome_get',
  'dna_chromosome_update',
  'dna_chromosome_validate',
  'dna_sequence_validate',
  'dna_defaults_get',
  'holon_join_request',
  'holon_join', // joined without the DNA hash; user_profile_ensure writes the profile, holon_apply asks
];

function setup() {
  const me = key();
  const hs = createHoloSphere({ appName: 'mcp-dna-test', privateKey: me.sk, store: { adapter: 'memory' } });
  const published: Array<{ kind: number; tags: string[][]; pubkey: string; id: string }> = [];
  (hs as unknown as { publishNostrEvents: (e: unknown) => void }).publishNostrEvents = (e) => published.push(...((Array.isArray(e) ? e : [e]) as never[]));
  // The relay replays what was published: a join request arrives to whoever watches for it.
  (hs as unknown as { subscribeNostr: (f: unknown, cb: (e: unknown) => void) => () => void }).subscribeNostr = (_f, cb) => {
    for (const e of published.filter((x) => x.kind === 9021)) setTimeout(() => cb(e), 0);
    return () => {};
  };
  let secret = me.sk;
  const deps: ToolDeps = { getHoloSphere: async () => hs, resolveActor: () => ({ id: '7' }) as never, getSignerSecret: () => secret };
  const { server, tools } = capture();
  registerDnaTools(server, deps);
  registerHolonsTools(server, deps);
  const call = async (name: string, args: Record<string, unknown>) => payload(await tools.get(name)!.run(args));
  return { me, hs, published, call, tools, deps, as: (sk: string) => ((secret = sk), hs.login(sk)) };
}

describe('tool list', () => {
  it('registers the new DNA tools and none of the retired ones', async () => {
    const { server, tools, dups } = capture();
    const deps: ToolDeps = { getHoloSphere: async () => ({}), resolveActor: () => ({ id: '1' }) as never };
    await registerAllTools(server, deps);
    const names = [...tools.keys()];
    expect(dups).toEqual([]);
    expect(names.filter((n) => n.startsWith('dna_') || n.startsWith('gene') || n.includes('chromosome')).sort()).toEqual([
      'dna_gene_put',
      'dna_gene_remove',
      'dna_get',
      'dna_reorder',
      'dna_templates_get',
      'dna_walk_steps',
    ]);
    expect(names).toContain('holon_apply');
    for (const gone of RETIRED) expect(names, gone).not.toContain(gone);
    expect(names.filter((n) => /join_request$/.test(n))).toEqual([]);
    expect(names).toEqual(expect.arrayContaining(['holon_join_requests', 'holon_join_approve', 'holon_leave', 'holon_list_mine', 'holon_remember', 'user_profile_ensure']));
  }, 30_000);
});

describe('tool list on a real McpServer', () => {
  it('registers every domain: no name is taken twice, so none is dropped', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const deps: ToolDeps = { getHoloSphere: async () => ({}), resolveActor: () => ({ id: '1' }) as never };
    await registerAllTools(server, deps);
    const names = Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
    expect(names).toEqual(
      expect.arrayContaining(['holon_apply', 'holon_leave', 'holon_list_mine', 'holon_remember', 'holon_telegram_unlink', 'user_profile_ensure', 'dna_get']),
    );
    for (const gone of RETIRED) expect(names, gone).not.toContain(gone);
    const leave = (server as unknown as { _registeredTools: Record<string, { description?: string }> })._registeredTools.holon_leave;
    expect(leave.description).toMatch(/9022/);
  }, 30_000);
});

describe('dna tools', () => {
  it('a holon with no DNA: the front validates, asking needs no agreement', async () => {
    const { call, published, hs } = setup();
    const H = (await call('holon_create', { name: 'Orto' })).holon as string;
    const front = await call('dna_get', { holon: H });
    expect(front).toMatchObject({ schema: 1, holon: H, empty: true, dna: { hash: null }, walk: [] });
    const walk = await call('dna_walk_steps', { holon: H });
    expect(walk).toMatchObject({ steps: [], progress: { complete: true, hash: null }, current: null, apply: { tool: 'holon_apply', acknowledged: null } });
    const applied = await call('holon_apply', { holon: H, name: 'Ada' });
    expect(applied.success).toBe(true);
    expect(published.find((e) => e.kind === 9021 && e.id === applied.eventId)?.tags.some((t) => t[0] === 'dna')).toBe(false);
    await hs.close();
  });

  it('write genes as an admin, walk them, apply with the agreed hash', async () => {
    const { call, hs, published, me } = setup();
    const H = (await call('holon_create', { name: 'Orto' })).holon as string;

    const templates = await call('dna_templates_get', { lang: 'it' });
    expect(templates.genes.map((g: { kind: string }) => g.kind)).toEqual(expect.arrayContaining(['purpose', 'values', 'terms']));

    const purpose = await call('dna_gene_put', { holon: H, gene: { kind: 'purpose', title: 'Purpose', blurb: 'We tend one garden together.' } });
    expect(purpose).toMatchObject({ success: true, gene: { id: 'purpose', ack: 'read', order: 0 } });
    const values = await call('dna_gene_put', {
      holon: H,
      gene: { kind: 'values', title: 'Values', blurb: 'What we hold on to.', alleles: [{ title: 'Care', body: 'We look after the soil.', icon: 'earth' }] },
    });
    expect(values.gene).toMatchObject({ id: 'values', ack: 'agree', alleles: [{ id: 'care', title: 'Care' }] });
    await call('dna_gene_put', { holon: H, gene: { kind: 'tools', title: 'Tools', blurb: 'Where things live.' } }); // ack: none

    const front = await call('dna_get', { holon: H });
    expect(front.empty).toBe(false);
    expect(front.about).toBe('We tend one garden together.');
    expect(front.genes.map((g: { id: string }) => g.id)).toEqual(['purpose', 'values', 'tools']);
    expect(front.walk.map((s: { gene: string }) => s.gene)).toEqual(['purpose', 'values']);
    const hash = front.dna.hash as string;
    expect(hash).toBe(dnaHash(await readGenes(hs, H)));

    // The walk: nothing acknowledged → first step, with its gene; stale ones are named.
    const start = await call('dna_walk_steps', { holon: H });
    expect(start.progress).toMatchObject({ current: 'purpose', complete: false, hash: null });
    expect(start.current.id).toBe('purpose');
    expect(start.apply).toBeNull();
    const genes = await readGenes(hs, H);
    const ph = geneHash(genes.find((g) => g.id === 'purpose')!, genes);
    const vh = geneHash(genes.find((g) => g.id === 'values')!, genes);
    const half = await call('dna_walk_steps', { holon: H, acks: { purpose: ph, values: '0'.repeat(64) } });
    expect(half.progress).toMatchObject({ current: 'values', done: ['purpose'], stale: ['values'], complete: false });
    const full = await call('dna_walk_steps', { holon: H, acks: { purpose: ph, values: vh } });
    expect(full.progress).toMatchObject({ complete: true, hash });
    expect(full.apply).toEqual({ tool: 'holon_apply', acknowledged: hash });

    // Asking: no hash, a wrong one, then the agreed one.
    const none = await call('holon_apply', { holon: H, name: 'Ada' });
    expect(none).toMatchObject({ success: false, reason: 'dna-not-acknowledged', dna: hash });
    const wrong = await call('holon_apply', { holon: H, name: 'Ada', acknowledged: 'f'.repeat(64) });
    expect(wrong).toMatchObject({ success: false, reason: 'dna-changed', dna: hash });
    const done = await call('holon_apply', { holon: H, name: 'Ada', acknowledged: hash });
    expect(done.success).toBe(true);
    const ev = published.find((e) => e.id === done.eventId)!;
    expect(parseJoinRequest(ev as never)).toMatchObject({ pubkey: me.pk, dna: hash });
  });

  it('refuses invalid genes with every issue, and edits that would not count', async () => {
    const { call, hs, as } = setup();
    const H = (await call('holon_create', { name: 'Orto' })).holon as string;
    await call('dna_gene_put', { holon: H, gene: { kind: 'purpose', title: 'Purpose', blurb: 'One.' } });

    const dup = await call('dna_gene_put', { holon: H, gene: { id: 'again', kind: 'purpose', title: 'Purpose again' } });
    expect(dup).toMatchObject({ success: false, reason: 'invalid' });
    expect(dup.issues.map((i: { code: string }) => i.code)).toContain('duplicate-kind');
    const long = await call('dna_gene_put', { holon: H, gene: { kind: 'custom', title: 'Long', blurb: 'x'.repeat(601) } });
    expect(long.issues).toEqual([expect.objectContaining({ code: 'too-long', field: 'blurb', limit: 600, actual: 601 })]);
    const ref = await call('dna_gene_put', { holon: H, gene: { kind: 'custom', title: 'Ref', alleles: [{ title: 'Nowhere', ref: 'purpose/nothing' }] } });
    expect(ref.issues.map((i: { code: string }) => i.code)).toContain('ref-missing');
    expect((await call('dna_get', { holon: H })).genes.map((g: { id: string }) => g.id)).toEqual(['purpose']); // nothing stored

    // A key the holon has not linked speaks for nobody: refused before the write.
    await as(key().sk);
    const held = await call('dna_gene_put', { holon: H, gene: { kind: 'custom', title: 'Mine', blurb: 'Not counted.' } });
    expect(held).toMatchObject({ success: false });
    expect(held.error).toMatch(/not linked|admin/i);
    expect((await call('dna_gene_remove', { holon: H, id: 'purpose' })).success).toBe(false);
    expect((await call('dna_reorder', { holon: H, ids: ['purpose'] })).success).toBe(false);
    expect((await call('dna_get', { holon: H })).genes.map((g: { id: string }) => g.id)).toEqual(['purpose']);
    await hs.close();
  });

  it('a change to a gene the person agreed to is a changed DNA; reorder is not', async () => {
    const { call, hs, as, me } = setup();
    const bob = key();
    const H = (await call('holon_create', { name: 'Orto' })).holon as string;
    await call('dna_gene_put', { holon: H, gene: { kind: 'values', title: 'Values', blurb: 'Care.' } });
    await call('dna_gene_put', { holon: H, gene: { kind: 'agreements', title: 'Agreements', blurb: 'Be kind.' } });
    const h1 = (await call('dna_get', { holon: H })).dna.hash as string;

    const order = await call('dna_reorder', { holon: H, ids: ['agreements', 'values'] });
    expect(order.genes).toEqual([{ id: 'agreements', order: 0 }, { id: 'values', order: 1 }]);
    expect((await call('dna_get', { holon: H })).dna.hash).toBe(h1);

    await call('dna_gene_put', { holon: H, gene: { id: 'values', blurb: 'Care, always.' } });
    const h2 = (await call('dna_get', { holon: H })).dna.hash as string;
    expect(h2).not.toBe(h1);
    const stale = await call('holon_apply', { holon: H, acknowledged: h1 });
    expect(stale).toMatchObject({ success: false, reason: 'dna-changed', dna: h2 });

    // Another person asks with the current hash: the admin's list says so, then says outdated when it moves.
    await as(bob.sk);
    expect((await call('holon_apply', { holon: H, name: 'Bob', acknowledged: h2 })).success).toBe(true);
    await as(me.sk);
    const first = await call('holon_join_requests', { holon: H, windowMs: 100 });
    expect(first.dna).toBe(h2);
    expect(first.requests).toEqual([expect.objectContaining({ pubkey: bob.pk, dna: h2, readiness: 'acknowledged' })]);
    await call('dna_gene_put', { holon: H, gene: { id: 'agreements', blurb: 'Be kind, and say so.' } });
    const later = await call('holon_join_requests', { holon: H, windowMs: 100 });
    expect(later.requests[0]).toMatchObject({ pubkey: bob.pk, readiness: 'outdated' });
    expect(later.dna).not.toBe(h2);
    expect((await call('dna_gene_remove', { holon: H, id: 'agreements' })).removed).toBe('agreements');
    await hs.close();
  });

  it('refuses removing a gene another still shows by ref', async () => {
    const { call, hs } = setup();
    const H = (await call('holon_create', { name: 'Orto' })).holon as string;
    await call('dna_gene_put', { holon: H, gene: { id: 'frameworks', kind: 'custom', title: 'Frameworks', alleles: [{ id: 'dsl', title: 'Sociocracy', body: 'Consent.' }] } });
    await call('dna_gene_put', { holon: H, gene: { id: 'practices', kind: 'practices', title: 'Practices', alleles: [{ id: 'dsl', title: 'Sociocracy', ref: 'frameworks/dsl' }] } });
    const refused = await call('dna_gene_remove', { holon: H, id: 'frameworks' });
    expect(refused).toMatchObject({ success: false, reason: 'invalid' });
    expect(refused.issues[0]).toMatchObject({ code: 'referenced', gene: 'frameworks' });
    const front = await call('dna_get', { holon: H });
    expect(front.genes.find((g: { id: string }) => g.id === 'frameworks').expressedIn).toEqual([{ gene: 'practices', title: 'Practices' }]);
    await hs.close();
  });
});

describe('the front contract', () => {
  it('never hands back a front that does not match the schema', async () => {
    const { call, hs } = setup();
    const H = (await call('holon_create', { name: 'Orto' })).holon as string;
    const front = await call('dna_get', { holon: H });
    expect(validatedFront(front)).toBe(front);
    expect(() => validatedFront({ ...front, schema: 2 })).toThrow(/holon-front\.schema/);
    expect(() => validatedFront({ ...front, extra: true })).toThrow(/holon-front\.schema/);
    await hs.close();
  });
});
