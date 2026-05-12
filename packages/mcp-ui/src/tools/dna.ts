import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  addChromosome,
  getAllDefaultChromosomes,
  getChromosome,
  getChromosomeLibrary,
  getDefaultChromosomesByType,
  getDNASequence,
  removeChromosome,
  saveDNASequence,
  seedChromosomeLibrary,
  updateChromosome,
  validateChromosome,
  validateDNA,
  validateDNASequence,
  type Chromosome,
  type DNASequence,
} from '@holons/core/dna';
import type { ToolDeps } from './index.js';

// ---- helpers ----------------------------------------------------------------

function ok(payload: Record<string, unknown>) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ success: true, ...payload }, null, 2),
      },
    ],
  };
}

function fail(error: string, extra: Record<string, unknown> = {}) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ success: false, error, ...extra }, null, 2),
      },
    ],
    isError: true,
  };
}

function parseJSON<T = unknown>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    throw new Error(`${label}: invalid JSON — ${(e as Error).message}`);
  }
}

/** Parse an optional inline library JSON arg into a Chromosome[]. */
function parseLibraryArg(library: string | undefined): Chromosome[] {
  if (!library) return [];
  const parsed = parseJSON<unknown>(library, 'library');
  if (!Array.isArray(parsed)) throw new Error('library: expected an array of Chromosome');
  return parsed as Chromosome[];
}

/** Coerce a `sequence` arg into the shape `saveDNASequence` expects.
 *  Accepts either a bare JSON array of ids or a full DNASequence object. */
function coerceSequenceInput(raw: string): { chromosomeIds: string[]; version?: number } {
  const parsed = parseJSON<unknown>(raw, 'sequence');
  if (Array.isArray(parsed)) {
    return { chromosomeIds: parsed.map(String) };
  }
  if (parsed && typeof parsed === 'object') {
    const seq = parsed as Partial<DNASequence>;
    if (!Array.isArray(seq.chromosomeIds)) {
      throw new Error('sequence: missing chromosomeIds[]');
    }
    return {
      chromosomeIds: seq.chromosomeIds.map(String),
      version: typeof seq.version === 'number' ? seq.version : undefined,
    };
  }
  throw new Error('sequence: expected JSON array of ids or DNASequence object');
}

// ---- registration -----------------------------------------------------------

export function registerDnaTools(server: McpServer, deps: ToolDeps): void {
  // 1. dna_validate ----------------------------------------------------------
  server.tool(
    'dna_validate',
    'Validate a DNA sequence against business rules (duplicates, max length, reference integrity). Library is loaded from holosphere if `holon` is supplied, otherwise it must be provided inline.',
    {
      sequence: z.string().describe('DNA sequence JSON ({ holonId, chromosomeIds, ... }).'),
      holon: z
        .string()
        .optional()
        .describe('Holon id — when set, the library is fetched from holosphere.'),
      library: z
        .string()
        .optional()
        .describe('Optional inline library JSON (Chromosome[]). Overrides the holosphere fetch.'),
    },
    async ({ sequence, holon, library }) => {
      try {
        const seq = parseJSON<DNASequence>(sequence, 'sequence');
        let lib: Chromosome[] = parseLibraryArg(library);
        if (!library && holon) {
          const hs = await deps.getHoloSphere();
          lib = await getChromosomeLibrary(hs, holon);
        }
        const result = validateDNA(seq, lib);
        return ok({ result, librarySize: lib.length });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // 2. chromosome_add --------------------------------------------------------
  server.tool(
    'chromosome_add',
    "Add a new chromosome to a holon's library. Returns the persisted record (with generated id/timestamps).",
    {
      holon: z.string().describe('Holon id.'),
      chromosome: z
        .string()
        .describe('Chromosome JSON: { name, type: value|tool|practice, description, icon?, color? }.'),
    },
    async ({ holon, chromosome }) => {
      try {
        const raw = parseJSON<Record<string, unknown>>(chromosome, 'chromosome');
        const draft = {
          holonId: typeof raw.holonId === 'string' ? raw.holonId : holon,
          name: String(raw.name ?? ''),
          type: raw.type as Chromosome['type'],
          description: String(raw.description ?? ''),
          icon: typeof raw.icon === 'string' ? raw.icon : undefined,
          color: typeof raw.color === 'string' ? raw.color : undefined,
        };
        const hs = await deps.getHoloSphere();
        const created = await addChromosome(hs, holon, draft);
        return ok({ chromosome: created });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // 3. chromosome_remove -----------------------------------------------------
  server.tool(
    'chromosome_remove',
    "Remove a chromosome from a holon's library by id.",
    {
      holon: z.string().describe('Holon id.'),
      chromosomeId: z.string().describe('Chromosome id to remove.'),
    },
    async ({ holon, chromosomeId }) => {
      try {
        const hs = await deps.getHoloSphere();
        await removeChromosome(hs, holon, chromosomeId);
        return ok({ holon, chromosomeId, removed: true });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // 4. chromosome_library_get ------------------------------------------------
  server.tool(
    'chromosome_library_get',
    "Read all chromosomes in a holon's library.",
    {
      holon: z.string().describe('Holon id.'),
    },
    async ({ holon }) => {
      try {
        const hs = await deps.getHoloSphere();
        const chromosomes = await getChromosomeLibrary(hs, holon);
        return ok({ holon, count: chromosomes.length, chromosomes });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // 5. chromosome_library_seed -----------------------------------------------
  server.tool(
    'chromosome_library_seed',
    "Seed a holon's library with the default value/tool/practice chromosomes.",
    {
      holon: z.string().describe('Holon id.'),
    },
    async ({ holon }) => {
      try {
        const hs = await deps.getHoloSphere();
        await seedChromosomeLibrary(hs, holon);
        return ok({ holon, seeded: true });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // 6. dna_sequence_get ------------------------------------------------------
  server.tool(
    'dna_sequence_get',
    "Read a holon's DNA sequence from holosphere, or null if absent.",
    {
      holon: z.string().describe('Holon id.'),
    },
    async ({ holon }) => {
      try {
        const hs = await deps.getHoloSphere();
        const sequence = await getDNASequence(hs, holon);
        return ok({ holon, sequence });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // 7. dna_sequence_save -----------------------------------------------------
  server.tool(
    'dna_sequence_save',
    "Save (or update) a holon's DNA sequence. Accepts either a JSON array of chromosome ids or a full DNASequence object.",
    {
      holon: z.string().describe('Holon id.'),
      sequence: z
        .string()
        .describe('DNASequence JSON ({ chromosomeIds, version? }) or a bare JSON array of ids.'),
    },
    async ({ holon, sequence }) => {
      try {
        const { chromosomeIds, version } = coerceSequenceInput(sequence);
        const hs = await deps.getHoloSphere();
        const saved = await saveDNASequence(hs, holon, chromosomeIds, version);
        return ok({ sequence: saved });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // 8. dna_chromosome_get ----------------------------------------------------
  server.tool(
    'dna_chromosome_get',
    "Read a single chromosome from a holon's library by id (returns null if missing).",
    {
      holon: z.string().describe('Holon id.'),
      chromosomeId: z.string().describe('Chromosome id.'),
    },
    async ({ holon, chromosomeId }) => {
      try {
        const hs = await deps.getHoloSphere();
        const chromosome = await getChromosome(hs, holon, chromosomeId);
        return ok({ holon, chromosomeId, chromosome });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // 9. dna_chromosome_update -------------------------------------------------
  server.tool(
    'dna_chromosome_update',
    "Update an existing chromosome. Pass the full chromosome JSON (must include `id`); only name/description/icon/color are mutable.",
    {
      holon: z.string().describe('Holon id.'),
      chromosome: z
        .string()
        .describe('Chromosome JSON — must include `id`. Mutable: name, description, icon, color.'),
    },
    async ({ holon, chromosome }) => {
      try {
        const raw = parseJSON<Record<string, unknown>>(chromosome, 'chromosome');
        const id = typeof raw.id === 'string' ? raw.id : '';
        if (!id) throw new Error('chromosome.id is required');
        const updates: Partial<Pick<Chromosome, 'name' | 'description' | 'icon' | 'color'>> = {};
        if (typeof raw.name === 'string') updates.name = raw.name;
        if (typeof raw.description === 'string') updates.description = raw.description;
        if (typeof raw.icon === 'string') updates.icon = raw.icon;
        if (typeof raw.color === 'string') updates.color = raw.color;
        const hs = await deps.getHoloSphere();
        const updated = await updateChromosome(hs, holon, id, updates);
        return ok({ chromosome: updated });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // 10. dna_chromosome_validate ---------------------------------------------
  server.tool(
    'dna_chromosome_validate',
    'Validate a single chromosome against business rules (name/type/description constraints). Pure — no holosphere access.',
    {
      chromosome: z.string().describe('Chromosome JSON.'),
      library: z
        .string()
        .optional()
        .describe('Optional inline library JSON (Chromosome[]) for duplicate-name detection.'),
    },
    async ({ chromosome, library }) => {
      try {
        const chromo = parseJSON<Chromosome>(chromosome, 'chromosome');
        const lib = parseLibraryArg(library);
        const result = validateChromosome(chromo, lib);
        return ok({ result });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // 11. dna_sequence_validate ------------------------------------------------
  server.tool(
    'dna_sequence_validate',
    'Validate a DNA sequence (alias of dna_validate that does not auto-load library from holosphere). Pure.',
    {
      sequence: z.string().describe('DNASequence JSON.'),
      library: z
        .string()
        .optional()
        .describe('Optional inline library JSON (Chromosome[]). Empty array if omitted.'),
    },
    async ({ sequence, library }) => {
      try {
        const seq = parseJSON<DNASequence>(sequence, 'sequence');
        const lib = parseLibraryArg(library);
        const result = validateDNASequence(seq, lib);
        return ok({ result, librarySize: lib.length });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // 12. dna_defaults_get -----------------------------------------------------
  server.tool(
    'dna_defaults_get',
    'Return the default seed chromosomes. Optionally filter by type (value | tool | practice).',
    {
      type: z
        .enum(['value', 'tool', 'practice'])
        .optional()
        .describe('Filter by chromosome type. Omit to get all defaults.'),
    },
    async ({ type }) => {
      try {
        const defaults = type
          ? getDefaultChromosomesByType(type)
          : getAllDefaultChromosomes();
        return ok({ type: type ?? 'all', count: defaults.length, chromosomes: defaults });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );
}
