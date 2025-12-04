# Data Model: Holon DNA Editor

**Date**: 2025-10-26
**Feature**: 001-holon-dna-editor

## Overview

This document defines the data entities, their attributes, relationships, validation rules, and state transitions for the Holon DNA Editor feature.

## Entities

### Chromosome

Represents a single governance element (value, tool, or practice) that can be added to a holon's DNA sequence.

**Attributes**:

| Field | Type | Required | Description | Constraints |
|-------|------|----------|-------------|-------------|
| `id` | string (UUID) | Yes | Unique identifier for the chromosome | Immutable after creation |
| `holonId` | string | Yes | ID of the holon that owns this chromosome | Immutable, references Holon entity |
| `name` | string | Yes | Display name of the chromosome | 1-100 characters, unique within holon's library |
| `type` | enum | Yes | Category of chromosome | One of: "value", "tool", "practice" |
| `description` | string | Yes | Explanation of what this chromosome represents | 10-500 characters |
| `createdAt` | timestamp | Yes | When chromosome was created | Auto-generated, ISO 8601 format |
| `updatedAt` | timestamp | Yes | Last modification time | Auto-updated on changes |
| `icon` | string | No | Optional icon identifier | Icon name from svelte-feather-icons or emoji |
| `color` | string | No | Optional custom color | Hex color code or TailwindCSS class |

**Validation Rules**:
- `name` must be unique within a holon's chromosome library
- `description` must be meaningful (not just whitespace)
- `type` must be one of the three predefined categories
- `holonId` must reference an existing holon

**Relationships**:
- **Belongs to**: One Holon (via `holonId`)
- **Referenced by**: Zero or more DNA Sequences (many-to-many through DNA sequence's `chromosomeIds` array)

**JSON Schema Reference**: `src/components/schemas/chromosome.schema.json`

---

### DNA Sequence

Represents the ordered collection of unique chromosomes that define a holon's governance structure.

**Attributes**:

| Field | Type | Required | Description | Constraints |
|-------|------|----------|-------------|-------------|
| `holonId` | string | Yes | ID of the holon this DNA belongs to | Primary key, immutable, one DNA per holon |
| `chromosomeIds` | array of strings | Yes | Ordered list of chromosome IDs in the sequence | 0-20 unique UUIDs, order matters |
| `createdAt` | timestamp | Yes | When DNA sequence was first created | Auto-generated, ISO 8601 format |
| `updatedAt` | timestamp | Yes | Last modification time | Auto-updated on changes |
| `version` | integer | Yes | Optimistic locking version number | Incremented on each save, starts at 1 |

**Validation Rules**:
- `chromosomeIds` array must contain 0-20 elements
- All IDs in `chromosomeIds` must be unique (no duplicates)
- All IDs in `chromosomeIds` must reference existing chromosomes in the holon's library
- `version` must increment monotonically

**Relationships**:
- **Belongs to**: Exactly one Holon (via `holonId`, 1:1 relationship)
- **References**: Zero to twenty Chromosomes (many-to-many, order preserved)

**State Transitions**:
1. **Empty** → User creates new DNA for a holon
2. **In Progress** → User adds/removes/reorders chromosomes
3. **Saved** → Changes persisted to holosphere
4. **Synced** → Other holon instances can query the DNA

**Conflict Resolution**:
- Last-write-wins: `version` field helps detect concurrent edits
- On conflict, the later save wins, earlier editor notified

**JSON Schema Reference**: `src/components/schemas/dna-sequence.schema.json`

---

### Chromosome Library (Derived Entity)

A holon-specific collection of all chromosomes available for DNA composition. Not a separate stored entity, but a logical grouping.

**Query Pattern**:
```typescript
// Get all chromosomes for a holon
holosphere.get('holons').get(holonId).get('chromosome_library').map()
```

**Attributes**:
- Collection of Chromosome entities filtered by `holonId`
- Categorized view by `type` (values, tools, practices)

**Operations**:
- **Add**: Create new chromosome in library
- **Edit**: Modify existing chromosome
- **Remove**: Delete chromosome from library (soft delete if used in DNA)

---

## Holosphere Data Structure

### Path Structure

```typescript
// Chromosome storage
holons/
  {holonId}/
    chromosome_library/
      {chromosomeId}/
        id: string
        holonId: string
        name: string
        type: "value" | "tool" | "practice"
        description: string
        createdAt: timestamp
        updatedAt: timestamp
        icon?: string
        color?: string

// DNA sequence storage
holons/
  {holonId}/
    dna_sequence/
      holonId: string
      chromosomeIds: [string, string, ...]
      createdAt: timestamp
      updatedAt: timestamp
      version: integer
```

### Access Patterns

**Read DNA Sequence**:
```typescript
holosphere
  .get('holons')
  .get(holonId)
  .get('dna_sequence')
  .once((data) => {
    // Handle DNA sequence data
  });
```

**Read Chromosome Library**:
```typescript
holosphere
  .get('holons')
  .get(holonId)
  .get('chromosome_library')
  .map()
  .once((chromosome, chromosomeId) => {
    // Handle each chromosome
  });
```

**Write DNA Sequence**:
```typescript
holosphere
  .get('holons')
  .get(holonId)
  .get('dna_sequence')
  .put({
    holonId,
    chromosomeIds,
    updatedAt: Date.now(),
    version: currentVersion + 1
  });
```

**Add Chromosome to Library**:
```typescript
const chromosomeId = generateUUID();
holosphere
  .get('holons')
  .get(holonId)
  .get('chromosome_library')
  .get(chromosomeId)
  .put({
    id: chromosomeId,
    holonId,
    name,
    type,
    description,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
```

## Data Integrity Rules

### Uniqueness Constraints

1. **Chromosome name within holon library**: Each chromosome name must be unique per holon
2. **DNA sequence per holon**: Each holon has exactly one DNA sequence
3. **Chromosome IDs in DNA sequence**: No duplicate chromosome IDs allowed

### Referential Integrity

1. **Chromosome → Holon**: Each chromosome must belong to a valid holon
2. **DNA Sequence → Chromosomes**: All chromosome IDs in a DNA sequence must exist in that holon's library
3. **Orphaned chromosomes**: If a chromosome is deleted from the library but exists in a DNA sequence, mark as "archived" rather than breaking the reference

### Validation on Save

Before persisting DNA sequence to holosphere:
1. Verify all chromosome IDs exist in the library
2. Verify no duplicate IDs in the sequence
3. Verify count ≤ 20
4. Verify version number is incremented
5. Set `updatedAt` to current timestamp

## TypeScript Type Definitions

```typescript
// src/lib/dna/types.ts

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
```

## Data Migration

**Initial State**: No existing DNA data in holosphere

**Seed Data** (optional):
- Provide default chromosome templates for common holonic governance patterns
- Allow holons to start with empty library or import seed chromosomes

**Version Evolution**:
- Schema version field allows for future data model changes
- Backward compatibility maintained through schema versioning

## Performance Considerations

### Indexing
- Chromosome library indexed by `holonId` for fast retrieval
- DNA sequence lookup by `holonId` is O(1)

### Caching
- Client-side caching of chromosome library for fast UI updates
- DNA sequence cached with version tracking for optimistic UI

### Pagination
- Library size target: 50 chromosomes per holon (no pagination needed)
- DNA sequence size: max 20 (no pagination needed)

## Security & Privacy

### Access Control
- **Read DNA Sequence**: Public - all holons can read
- **Write DNA Sequence**: Holon administrators only
- **Read Chromosome Library**: Holon administrators only (library is not public)
- **Write Chromosome Library**: Holon administrators only

### Data Visibility
- DNA sequences are publicly queryable across the holon network
- Chromosome libraries are private to each holon
- Full chromosome details visible when viewing a holon's public DNA

## Summary

The data model defines two core entities (Chromosome and DNA Sequence) with clear relationships, validation rules, and holosphere storage patterns. The model supports the feature requirements including:
- Maximum 20 unique chromosomes per DNA sequence
- Holon-specific chromosome libraries
- Public DNA visibility with private library management
- Last-write-wins conflict resolution via version field
- Referential integrity between sequences and libraries
