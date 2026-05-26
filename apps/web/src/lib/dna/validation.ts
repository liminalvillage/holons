// Re-export from @holons/core/dna. Source of truth lives in packages/core/src/dna/validation.ts.
export {
  MAX_CHROMOSOMES_PER_DNA,
  createDNAError,
  findDuplicates,
  findInvalidReferences,
  validateChromosome,
  validateDNA,
  validateDNASequence,
} from "@holons/core/dna";
