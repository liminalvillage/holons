// TypeScript types for Holon DNA Editor
// Feature: 001-holon-dna-editor

export type ChromosomeType = 'value' | 'tool' | 'practice';

export interface Chromosome {
  id: string;
  holonId: string;
  name: string;
  type: ChromosomeType;
  description: string;
  createdAt: number; // Unix timestamp
  updatedAt: number;
  icon?: string;
  color?: string;
}

export interface DNASequence {
  holonId: string;
  chromosomeIds: string[]; // Ordered, unique, max 20
  createdAt: number;
  updatedAt: number;
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
