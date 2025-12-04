// Validation logic for Holon DNA Editor
// Feature: 001-holon-dna-editor

import type { DNASequence, Chromosome, ValidationResult, DNAValidationError } from './types';

/**
 * Validates a DNA sequence against business rules
 * @param sequence The DNA sequence to validate
 * @param library The available chromosomes in the library
 * @returns Validation result with isValid flag and error messages
 */
export function validateDNASequence(
  sequence: DNASequence,
  library: Chromosome[]
): ValidationResult {
  const errors: string[] = [];

  // Max 20 chromosomes
  if (sequence.chromosomeIds.length > 20) {
    errors.push('Maximum 20 chromosomes allowed in a DNA sequence');
  }

  // No duplicates
  const uniqueIds = new Set(sequence.chromosomeIds);
  if (uniqueIds.size !== sequence.chromosomeIds.length) {
    errors.push('Duplicate chromosomes not allowed in DNA sequence');
  }

  // All IDs must exist in library
  const libraryIds = new Set(library.map(c => c.id));
  sequence.chromosomeIds.forEach(id => {
    if (!libraryIds.has(id)) {
      errors.push(`Chromosome ${id} not found in library`);
    }
  });

  return { isValid: errors.length === 0, errors };
}

/**
 * Validates a single chromosome against business rules
 * @param chromosome The chromosome to validate
 * @param existingLibrary The existing chromosomes in the library (for name uniqueness check)
 * @returns Validation result with isValid flag and error messages
 */
export function validateChromosome(
  chromosome: Chromosome,
  existingLibrary: Chromosome[] = []
): ValidationResult {
  const errors: string[] = [];

  // Name validation
  if (!chromosome.name || chromosome.name.trim().length === 0) {
    errors.push('Chromosome name is required');
  } else if (chromosome.name.length > 100) {
    errors.push('Chromosome name must be 100 characters or less');
  }

  // Name uniqueness within holon library
  const duplicateName = existingLibrary.find(
    c => c.id !== chromosome.id && c.name === chromosome.name && c.holonId === chromosome.holonId
  );
  if (duplicateName) {
    errors.push(`Chromosome name "${chromosome.name}" already exists in this holon's library`);
  }

  // Type validation
  const validTypes = ['value', 'tool', 'practice'];
  if (!validTypes.includes(chromosome.type)) {
    errors.push(`Chromosome type must be one of: ${validTypes.join(', ')}`);
  }

  // Description validation
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
 * @param type The type of validation error
 * @param message The error message
 * @param chromosomeId Optional chromosome ID related to the error
 * @returns DNAValidationError object
 */
export function createDNAError(
  type: DNAValidationError['type'],
  message: string,
  chromosomeId?: string
): DNAValidationError {
  return { type, message, chromosomeId };
}

/**
 * Checks if a DNA sequence has duplicates
 * @param chromosomeIds Array of chromosome IDs to check
 * @returns Array of duplicate chromosome IDs
 */
export function findDuplicates(chromosomeIds: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  chromosomeIds.forEach(id => {
    if (seen.has(id)) {
      duplicates.add(id);
    }
    seen.add(id);
  });

  return Array.from(duplicates);
}

/**
 * Checks if a DNA sequence has any invalid chromosome references
 * @param chromosomeIds Array of chromosome IDs in the sequence
 * @param library Available chromosomes in the library
 * @returns Array of invalid chromosome IDs
 */
export function findInvalidReferences(
  chromosomeIds: string[],
  library: Chromosome[]
): string[] {
  const libraryIds = new Set(library.map(c => c.id));
  return chromosomeIds.filter(id => !libraryIds.has(id));
}
