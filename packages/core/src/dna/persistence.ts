// Holosphere persistence layer for chromosomes and DNA sequences.

import type { HoloSphere } from 'holosphere';
import type { Chromosome, DNASequence } from './types.js';
import { validateChromosome } from './validation.js';
import { getAllDefaultChromosomes, type SeedChromosome } from './seed-data.js';

const DNA_KEY = 'dna_sequence';
const LIBRARY_KEY = 'chromosome_library';

/** Read a holon's DNA sequence from holosphere, or null if absent. */
export async function getDNASequence(
  holosphere: HoloSphere,
  holonId: string
): Promise<DNASequence | null> {
  try {
    const data = await holosphere.get(holonId, DNA_KEY);
    if (!data || typeof data !== 'object') {
      return null;
    }
    // Promote legacy `createdAt`/`updatedAt` (ms epoch) to canonical
    // `created`/`updated` (ISO string) so consumers always see one shape.
    const raw = data as any;
    return {
      ...raw,
      created: typeof raw.created === 'string'
        ? raw.created
        : (typeof raw.createdAt === 'number' ? new Date(raw.createdAt).toISOString() : new Date().toISOString()),
      updated: typeof raw.updated === 'string'
        ? raw.updated
        : (typeof raw.updatedAt === 'number' ? new Date(raw.updatedAt).toISOString() : new Date().toISOString()),
    } as DNASequence;
  } catch (error) {
    console.error('Error getting DNA sequence:', error);
    return null;
  }
}

/** Save (or update) a holon's DNA sequence, returning the persisted record. */
export async function saveDNASequence(
  holosphere: HoloSphere,
  holonId: string,
  chromosomeIds: string[],
  currentVersion?: number
): Promise<DNASequence> {
  try {
    const nowIso = new Date().toISOString();
    const existing = await getDNASequence(holosphere, holonId);

    const dna: DNASequence = {
      holonId,
      chromosomeIds,
      updated: nowIso,
      version: (currentVersion || 0) + 1,
      created: existing?.created || nowIso
    };

    await holosphere.put(holonId, DNA_KEY, dna);
    return dna;
  } catch (error) {
    console.error('Error saving DNA sequence:', error);
    throw error;
  }
}

/** Hydrate a stored chromosome record, applying defaults for missing fields. */
function hydrateChromosome(
  raw: Record<string, any>,
  fallbackId: string,
  fallbackHolonId: string
): Chromosome {
  // Read canonical `created`/`updated` (ISO) first; fall back to the legacy
  // `createdAt`/`updatedAt` (ms epoch) so records written before the unify
  // still hydrate with a usable ISO string.
  const created = typeof raw.created === 'string'
    ? raw.created
    : (typeof raw.createdAt === 'number' ? new Date(raw.createdAt).toISOString() : new Date().toISOString());
  const updated = typeof raw.updated === 'string'
    ? raw.updated
    : (typeof raw.updatedAt === 'number' ? new Date(raw.updatedAt).toISOString() : created);
  return {
    id: raw.id || fallbackId,
    holonId: raw.holonId || fallbackHolonId,
    name: raw.name || '',
    type: raw.type || 'value',
    description: raw.description || '',
    icon: raw.icon,
    color: raw.color,
    created,
    updated
  };
}

/** Read the raw library object plus an array of hydrated chromosomes (single fetch). */
async function readLibrary(
  holosphere: HoloSphere,
  holonId: string
): Promise<{ raw: Record<string, any>; chromosomes: Chromosome[] }> {
  const data = await holosphere.get(holonId, LIBRARY_KEY);
  if (!data || typeof data !== 'object') {
    return { raw: {}, chromosomes: [] };
  }
  const chromosomes: Chromosome[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('_')) continue;
    if (!value || typeof value !== 'object') continue;
    chromosomes.push(hydrateChromosome(value as Record<string, any>, key, holonId));
  }
  return { raw: data as Record<string, any>, chromosomes };
}

/** Read all chromosomes in a holon's library. */
export async function getChromosomeLibrary(
  holosphere: HoloSphere,
  holonId: string
): Promise<Chromosome[]> {
  try {
    const { chromosomes } = await readLibrary(holosphere, holonId);
    return chromosomes;
  } catch (error) {
    console.error('Error getting chromosome library:', error);
    return [];
  }
}

/** Add a new chromosome to a holon's library. */
export async function addChromosome(
  holosphere: HoloSphere,
  holonId: string,
  chromosome: Omit<Chromosome, 'id' | 'created' | 'updated'>
): Promise<Chromosome> {
  try {
    const { raw, chromosomes } = await readLibrary(holosphere, holonId);
    const nowIso = new Date().toISOString();
    const newChromosome: Chromosome = {
      id: generateUUID(),
      holonId,
      name: chromosome.name,
      type: chromosome.type,
      description: chromosome.description,
      icon: chromosome.icon,
      color: chromosome.color,
      created: nowIso,
      updated: nowIso
    };

    const validation = validateChromosome(newChromosome, chromosomes);
    if (!validation.isValid) {
      throw new Error(`Chromosome validation failed: ${validation.errors.join(', ')}`);
    }

    await holosphere.put(holonId, LIBRARY_KEY, {
      ...raw,
      [newChromosome.id]: newChromosome
    });

    return newChromosome;
  } catch (error) {
    console.error('Error adding chromosome:', error);
    throw error;
  }
}

/** Update an existing chromosome. */
export async function updateChromosome(
  holosphere: HoloSphere,
  holonId: string,
  chromosomeId: string,
  updates: Partial<Pick<Chromosome, 'name' | 'description' | 'icon' | 'color'>>
): Promise<Chromosome> {
  try {
    const { raw, chromosomes } = await readLibrary(holosphere, holonId);
    const existing = chromosomes.find((c) => c.id === chromosomeId);
    if (!existing) {
      throw new Error(`Chromosome ${chromosomeId} not found`);
    }

    const updatedChromosome: Chromosome = {
      ...existing,
      ...updates,
      updated: new Date().toISOString()
    };

    const validation = validateChromosome(updatedChromosome, chromosomes);
    if (!validation.isValid) {
      throw new Error(`Chromosome validation failed: ${validation.errors.join(', ')}`);
    }

    await holosphere.put(holonId, LIBRARY_KEY, {
      ...raw,
      [chromosomeId]: updatedChromosome
    });

    return updatedChromosome;
  } catch (error) {
    console.error('Error updating chromosome:', error);
    throw error;
  }
}

/** Remove a chromosome from a holon's library. */
export async function removeChromosome(
  holosphere: HoloSphere,
  holonId: string,
  chromosomeId: string
): Promise<void> {
  try {
    const currentLibrary = (await holosphere.get(holonId, LIBRARY_KEY)) || {};
    const { [chromosomeId]: _removed, ...updatedLibrary } = currentLibrary;
    await holosphere.put(holonId, LIBRARY_KEY, updatedLibrary);
  } catch (error) {
    console.error('Error removing chromosome:', error);
    throw error;
  }
}

/** Read a single chromosome by id, or null if missing. */
export async function getChromosome(
  holosphere: HoloSphere,
  holonId: string,
  chromosomeId: string
): Promise<Chromosome | null> {
  try {
    const library = await holosphere.get(holonId, LIBRARY_KEY);
    if (!library || typeof library !== 'object') {
      return null;
    }
    const data = library[chromosomeId];
    if (!data || typeof data !== 'object') {
      return null;
    }
    return hydrateChromosome(data, chromosomeId, holonId);
  } catch (error) {
    console.error('Error getting chromosome:', error);
    return null;
  }
}

/** Subscribe to real-time DNA sequence updates. */
export function subscribeToDNASequence(
  holosphere: HoloSphere,
  holonId: string,
  callback: (dna: DNASequence | null) => void
): () => void {
  const handler = (data: any) => {
    if (!data || typeof data !== 'object') {
      callback(null);
      return;
    }
    callback(data as DNASequence);
  };

  const sub = holosphere.subscribe(holonId, DNA_KEY, handler);
  return () => sub.unsubscribe();
}

/** Subscribe to chromosome library changes. */
export function subscribeToChromosomeLibrary(
  holosphere: HoloSphere,
  holonId: string,
  callback: (chromosome: Chromosome | null, chromosomeId: string) => void
): () => void {
  const handler = (data: any, key?: string) => {
    if (!key || key.startsWith('_')) return;

    if (!data || typeof data !== 'object') {
      callback(null, key);
      return;
    }

    try {
      const chromosome = hydrateChromosome(data, key, holonId);
      if (chromosome.name) {
        callback(chromosome, key);
      }
    } catch (error) {
      console.error('[subscribeToChromosomeLibrary] Error processing chromosome:', error);
      callback(null, key);
    }
  };

  const sub = holosphere.subscribe(holonId, LIBRARY_KEY, handler);
  return () => sub.unsubscribe();
}

/** Seed a holon's library with the default value/tool/practice chromosomes. */
export async function seedChromosomeLibrary(
  holosphere: HoloSphere,
  holonId: string
): Promise<void> {
  try {
    const defaults = getAllDefaultChromosomes();
    const library: Record<string, Chromosome> = {};

    defaults.forEach((seed: SeedChromosome) => {
      const id = generateUUID();
      const nowIso = new Date().toISOString();
      library[id] = {
        id,
        holonId,
        name: seed.name,
        type: seed.type,
        description: seed.description,
        icon: seed.icon,
        created: nowIso,
        updated: nowIso
      };
    });

    await holosphere.put(holonId, LIBRARY_KEY, library);
  } catch (error) {
    console.error('Error seeding chromosome library:', error);
    throw error;
  }
}

/** RFC4122 v4 UUID generator (Math.random based — non-cryptographic). */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
