import type { DNASequence, Chromosome, ValidationResult, DNAValidationError } from './types.js';

export const MAX_CHROMOSOMES_PER_DNA = 20;

/**
 * Validates a DNA sequence against business rules
 */
export function validateDNASequence(
  sequence: DNASequence,
  library: Chromosome[]
): ValidationResult {
  const errors: string[] = [];

  if (sequence.chromosomeIds.length > MAX_CHROMOSOMES_PER_DNA) {
    errors.push(`Maximum ${MAX_CHROMOSOMES_PER_DNA} chromosomes allowed in a DNA sequence`);
  }

  const uniqueIds = new Set(sequence.chromosomeIds);
  if (uniqueIds.size !== sequence.chromosomeIds.length) {
    errors.push('Duplicate chromosomes not allowed in DNA sequence');
  }

  const libraryIds = new Set(library.map((c) => c.id));
  sequence.chromosomeIds.forEach((id) => {
    if (!libraryIds.has(id)) {
      errors.push(`Chromosome ${id} not found in library`);
    }
  });

  return { isValid: errors.length === 0, errors };
}

/**
 * Convenience alias kept for backwards compatibility with prior call sites.
 */
export const validateDNA = validateDNASequence;

/**
 * Validates a single chromosome against business rules
 */
export function validateChromosome(
  chromosome: Chromosome,
  existingLibrary: Chromosome[] = []
): ValidationResult {
  const errors: string[] = [];

  if (!chromosome.name || chromosome.name.trim().length === 0) {
    errors.push('Chromosome name is required');
  } else if (chromosome.name.length > 100) {
    errors.push('Chromosome name must be 100 characters or less');
  }

  const duplicateName = existingLibrary.find(
    (c) => c.id !== chromosome.id && c.name === chromosome.name && c.holonId === chromosome.holonId
  );
  if (duplicateName) {
    errors.push(`Chromosome name "${chromosome.name}" already exists in this holon's library`);
  }

  const validTypes: Chromosome['type'][] = ['value', 'tool', 'practice'];
  if (!validTypes.includes(chromosome.type)) {
    errors.push(`Chromosome type must be one of: ${validTypes.join(', ')}`);
  }

  if (!chromosome.description || chromosome.description.trim().length === 0) {
    errors.push('Chromosome description is required');
  } else if (chromosome.description.length < 10) {
    errors.push('Chromosome description must be at least 10 characters');
  } else if (chromosome.description.length > 500) {
    errors.push('Chromosome description must be 500 characters or less');
  }

  return { isValid: errors.length === 0, errors };
}

/**
 * Creates a detailed DNA validation error
 */
export function createDNAError(
  type: DNAValidationError['type'],
  message: string,
  chromosomeId?: string
): DNAValidationError {
  return { type, message, chromosomeId };
}

/**
 * Returns IDs that appear more than once in the input list.
 */
export function findDuplicates(chromosomeIds: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  chromosomeIds.forEach((id) => {
    if (seen.has(id)) {
      duplicates.add(id);
    }
    seen.add(id);
  });

  return Array.from(duplicates);
}

/**
 * Returns IDs that don't exist in the provided library.
 */
export function findInvalidReferences(
  chromosomeIds: string[],
  library: Chromosome[]
): string[] {
  const libraryIds = new Set(library.map((c) => c.id));
  return chromosomeIds.filter((id) => !libraryIds.has(id));
}
