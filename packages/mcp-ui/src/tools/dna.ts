// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Thin MCP wrappers around @holons/core/dna: a holon's DNA (its genes) as the
// one front page every surface renders, the walk a person takes before asking
// to join, and the admin edits of the genes. Everything the tools say is
// decided in core — the front, the hashes, the limits; these only call it and
// surface its refusals. Asking to join is `holon_apply` (tools/holons.ts).
//
// `dna_get` never hands back a front that does not validate against
// `@holons/core/schemas/holon-front.schema.json`, the published contract the
// website and the kiosk endpoint share.

import { createRequire } from 'node:module';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ACK_MODES,
  ALLELE_ICONS,
  GENE_KINDS,
  GeneInvalid,
  HolonFrontUnreachable,
  STARTER_GENES,
  STARTER_LANGS,
  normalizeWalkState,
  putGene,
  readHolonFront,
  removeGene,
  reorderGenes,
  walkProgress,
  type GeneDraft,
  type HolonFront,
} from '@holons/core/dna';
import frontSchema from '@holons/core/schemas/holon-front.schema.json' with { type: 'json' };
import type { ToolDeps } from './index.js';
import { gate } from './standing.js';

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string, extra?: Record<string, unknown>) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message, ...(extra ?? {}) }, null, 2) }],
  };
}

// The contract is checked with the Ajv the schema was written for (strict, all
// errors), as core's own front spec and the kiosk endpoint spec do.
type Validate = ((data: unknown) => boolean) & { errors?: unknown[] | null };
let compiled: Validate | null = null;
function frontValidator(): Validate {
  if (compiled) return compiled;
  const Ajv = createRequire(import.meta.url)('ajv') as new (opts?: Record<string, unknown>) => { compile(schema: unknown): Validate };
  compiled = new Ajv({ allErrors: true, strict: true }).compile(frontSchema);
  return compiled;
}

/** The front, only when it is the published shape. Throws with the schema's complaints otherwise. */
export function validatedFront(front: HolonFront): HolonFront {
  const validate = frontValidator();
  if (!validate(front)) throw new FrontContractError(validate.errors ?? []);
  return front;
}

class FrontContractError extends Error {
  readonly errors: unknown[];
  constructor(errors: unknown[]) {
    super('The front does not match holon-front.schema.json');
    this.name = 'FrontContractError';
    this.errors = errors;
  }
}

const hex64 = z.string().regex(/^[0-9a-fA-F]{64}$/);

const geneLink = z.object({
  label: z.string(),
  href: z.string().describe('http(s) or mailto: link'),
  icon: z.enum(ALLELE_ICONS as unknown as [string, ...string[]]).optional(),
});

const allele = z.object({
  id: z.string().optional().describe('Slug, unique in its gene; made from the title when left out.'),
  title: z.string(),
  kicker: z.string().optional(),
  body: z.string().optional(),
  icon: z.enum(ALLELE_ICONS as unknown as [string, ...string[]]).optional().describe('A semantic key, never an emoji.'),
  link: geneLink.optional(),
  detail: z
    .object({
      body: z.string(),
      steps: z.array(z.string()).optional(),
      links: z.array(geneLink).optional(),
      image: z.object({ src: z.string(), alt: z.string() }).optional(),
    })
    .optional()
    .describe('The long form of the card (a framework explained).'),
  ref: z.string().optional().describe('"<geneId>/<alleleId>": show that allele here instead. It must exist and not be a ref itself.'),
});

const geneInput = z.object({
  id: z.string().optional().describe('The gene\'s slug. Naming a stored gene updates it: only the parts you name change (an `alleles` list replaces the whole list). Left out: made from the kind (purpose, terms) or the title.'),
  kind: z.enum(GENE_KINDS as unknown as [string, ...string[]]).optional().describe('purpose and terms: at most one each.'),
  title: z.string().optional(),
  blurb: z.string().optional().describe('The gene in a few sentences (the purpose gene\'s blurb is the holon\'s "about").'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  order: z.number().optional().describe('Place on the front page; left out: kept, or last for a new gene.'),
  ack: z
    .enum(ACK_MODES as unknown as [string, ...string[]])
    .optional()
    .describe('What a person must do with this gene before asking to join: none, read, or agree. Changing the text of a gene that asks for one asks everyone to acknowledge the DNA again.'),
  lang: z.string().optional().describe('The language the text is written in.'),
  links: z.array(geneLink).optional(),
  alleles: z.array(allele).optional(),
});

export function registerDnaTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'dna_get',
    {
      description:
        "A holon's front page: its DNA — genes (purpose, values, agreements, practices, roles, tools, terms) holding alleles — with the hash that names this version, the steps of the walk before asking to join, what happens after the request, and how many people are linked. Public: the same view every surface renders, validated against holon-front.schema.json. Read it to a person before holon_apply: the DNA hash they agree to is `dna.hash`. `viewer` (a hex pubkey) picks that key's call to action; leave it out for the anonymous visitor's.",
      inputSchema: {
        holon: z.string(),
        viewer: hex64.optional(),
        catchUpMs: z.number().int().min(100).max(30000).optional().describe('How long a cold read may catch up from the relays (default 4000).'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const front = await readHolonFront(hs, args.holon, { viewer: args.viewer?.toLowerCase(), catchUpMs: args.catchUpMs });
        return ok(validatedFront(front));
      } catch (err) {
        if (err instanceof HolonFrontUnreachable) return fail(err.message, { reason: 'unreachable', retry: true });
        if (err instanceof FrontContractError) return fail(err.message, { reason: 'schema', errors: err.errors });
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'dna_walk_steps',
    {
      description:
        "The walk a person takes before asking to join: one step per gene that asks to be read or agreed to, in order, each with the hash of the gene as it is now. Pass `acks` (gene id → the gene hash the person acknowledged) to see where they stand: the step they are on (with its gene), steps done, steps changed since they acknowledged them, and — only once every step is done — the DNA hash to hand holon_apply as `acknowledged`. A gene changed since is stale: show it again.",
      inputSchema: {
        holon: z.string(),
        acks: z.record(z.string(), hex64).optional().describe('Gene id → geneHash acknowledged so far. Omit before the walk starts.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const front = await readHolonFront(hs, args.holon);
        const progress = walkProgress(front.walk, normalizeWalkState({ acks: args.acks ?? {} }), front.dna.hash);
        return ok({
          holon: args.holon,
          name: front.name,
          dna: front.dna,
          steps: front.walk,
          after: front.after,
          progress,
          current: progress.current ? (front.genes.find((g) => g.id === progress.current) ?? null) : null,
          apply: progress.complete ? { tool: 'holon_apply', acknowledged: progress.hash } : null,
        });
      } catch (err) {
        if (err instanceof HolonFrontUnreachable) return fail(err.message, { reason: 'unreachable', retry: true });
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'dna_templates_get',
    {
      description: 'The starter genes (purpose, values, agreements, practices, roles, tools, terms) with suggested alleles, to start a holon\'s DNA from. Pass one to dna_gene_put once the holon has made it its own.',
      inputSchema: { lang: z.enum(STARTER_LANGS as unknown as [string, ...string[]]).optional().describe('Default en.') },
    },
    async (args) => ok({ lang: args.lang ?? 'en', genes: STARTER_GENES(args.lang ?? 'en') }),
  );

  const write = async (holon: string, run: (hs: any) => Promise<Record<string, unknown>>) => {
    try {
      const hs = await deps.getHoloSphere();
      const g = await gate(hs, holon, 'dna');
      if (g.refusal) return fail(g.refusal, { standing: g.standing });
      return ok({ success: true, holon, ...(await run(hs)) });
    } catch (err) {
      if (err instanceof GeneInvalid) return fail(err.message, { reason: 'invalid', issues: err.issues });
      return fail((err as Error).message);
    }
  };

  server.registerTool(
    'dna_gene_put',
    {
      description:
        "Write one gene of a holon's DNA (admins only: the genes lens is guarded, a write by anyone else is recorded but never counted). Normalized and validated by core: an invalid gene is refused with every issue (too long, too large for a relay, a duplicate purpose or terms gene, a broken ref, …) and nothing is stored. Naming a stored gene changes only the parts given. Changing the text of a gene that asks for an acknowledgement changes the DNA hash, so anyone who agreed to the old one must walk it again.",
      inputSchema: { holon: z.string(), gene: geneInput },
    },
    async (args) => write(args.holon, async (hs) => ({ gene: await putGene(hs, args.holon, args.gene as GeneDraft) })),
  );

  server.registerTool(
    'dna_gene_remove',
    {
      description: "Remove one gene of a holon's DNA (admins only). Refused while another gene still shows one of its alleles by ref. Removing a gene that asked for an acknowledgement changes the DNA hash.",
      inputSchema: { holon: z.string(), id: z.string() },
    },
    async (args) =>
      write(args.holon, async (hs) => {
        await removeGene(hs, args.holon, args.id);
        return { removed: args.id };
      }),
  );

  server.registerTool(
    'dna_reorder',
    {
      description: "Put a holon's genes in the order of `ids` (admins only; genes not named follow as they were). Order is not part of the DNA hash: nobody has to acknowledge again.",
      inputSchema: { holon: z.string(), ids: z.array(z.string()).min(1) },
    },
    async (args) =>
      write(args.holon, async (hs) => ({ genes: (await reorderGenes(hs, args.holon, args.ids)).map((g) => ({ id: g.id, order: g.order })) })),
  );
}
