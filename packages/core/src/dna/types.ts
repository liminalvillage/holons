// Types for the Holon DNA domain (chromosomes + ordered DNA sequence).

export type ChromosomeType = 'value' | 'tool' | 'practice';

export interface Chromosome {
  id: string;
  holonId: string;
  name: string;
  type: ChromosomeType;
  description: string;
  /** Canonical creation timestamp (ISO 8601 string). */
  created: string;
  /** Canonical modification timestamp (ISO 8601 string). */
  updated: string;
  icon?: string;
  color?: string;
}

export interface DNASequence {
  holonId: string;
  chromosomeIds: string[]; // Ordered, unique, max 20
  /** Canonical creation timestamp (ISO 8601 string). */
  created: string;
  /** Canonical modification timestamp (ISO 8601 string). */
  updated: string;
  version: number;
}

export interface ChromosomeLibrary {
  holonId: string;
  chromosomes: Map<string, Chromosome>;
}

// Validation result types
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface DNAValidationError {
  type: 'duplicate' | 'max_length' | 'invalid_reference' | 'missing_required';
  message: string;
  chromosomeId?: string;
}
