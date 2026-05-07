// @holons/core/dna — Holon DNA domain (chromosomes + DNA sequence).
// UI-agnostic: shared by web, telegram, and future AI/text UIs.

export type {
  Chromosome,
  ChromosomeLibrary,
  ChromosomeType,
  DNASequence,
  DNAValidationError,
  ValidationResult
} from './types.js';

export {
  MAX_CHROMOSOMES_PER_DNA,
  createDNAError,
  findDuplicates,
  findInvalidReferences,
  validateChromosome,
  validateDNA,
  validateDNASequence
} from './validation.js';

export {
  defaultPractices,
  defaultTools,
  defaultValues,
  getAllDefaultChromosomes,
  getDefaultChromosomesByType,
  type SeedChromosome
} from './seed-data.js';

export {
  addChromosome,
  getChromosome,
  getChromosomeLibrary,
  getDNASequence,
  removeChromosome,
  saveDNASequence,
  seedChromosomeLibrary,
  subscribeToChromosomeLibrary,
  subscribeToDNASequence,
  updateChromosome
} from './persistence.js';
