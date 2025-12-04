# Holosphere Operations Contract

**Feature**: Holon DNA Editor
**Date**: 2025-10-26

## Overview

This contract defines the holosphere data operations for the DNA Editor feature. Since holosphere uses GunDB for peer-to-peer data synchronization, these are not traditional REST API endpoints but rather data access patterns and methods.

## Data Operations

### 1. Read DNA Sequence

**Operation**: Get a holon's DNA sequence from holosphere

**Path Pattern**: `holons/{holonId}/dna_sequence`

**Method Signature**:
```typescript
function getDNASequence(
  holosphere: HoloSphere,
  holonId: string
): Promise<DNASequence | null>
```

**Input**:
- `holonId`: string (required) - The holon identifier

**Output**:
```typescript
{
  holonId: string;
  chromosomeIds: string[];      // Ordered array, 0-20 elements
  createdAt: number;             // Unix timestamp
  updatedAt: number;             // Unix timestamp
  version: number;               // Optimistic lock version
}
```

**Success Response**: DNASequence object
**Not Found Response**: null (holon has no DNA yet)
**Error Response**: Promise rejection with error message

**Access Control**: Public read (all holons)

**Example**:
```typescript
const dnaSequence = await getDNASequence(holosphere, 'holon-123');
if (dnaSequence) {
  console.log(`DNA has ${dnaSequence.chromosomeIds.length} chromosomes`);
}
```

---

### 2. Write DNA Sequence

**Operation**: Save or update a holon's DNA sequence

**Path Pattern**: `holons/{holonId}/dna_sequence`

**Method Signature**:
```typescript
function saveDNASequence(
  holosphere: HoloSphere,
  holonId: string,
  chromosomeIds: string[],
  currentVersion?: number
): Promise<DNASequence>
```

**Input**:
- `holonId`: string (required) - The holon identifier
- `chromosomeIds`: string[] (required) - Ordered array of chromosome IDs
- `currentVersion`: number (optional) - Current version for conflict detection

**Validation**:
- `chromosomeIds` must contain 0-20 elements
- All IDs must be unique (no duplicates)
- All IDs must reference existing chromosomes in the library

**Output**:
```typescript
{
  holonId: string;
  chromosomeIds: string[];
  createdAt: number;
  updatedAt: number;
  version: number;               // Incremented version
}
```

**Success Response**: Updated DNASequence object
**Validation Error**: Promise rejection with validation errors
**Conflict Response**: Warning notification (last-write-wins, no rejection)

**Access Control**: Holon administrators only (write)

**Side Effects**:
- Updates `updatedAt` timestamp
- Increments `version` number
- Triggers real-time sync to other holon instances

**Example**:
```typescript
const updatedDNA = await saveDNASequence(
  holosphere,
  'holon-123',
  ['chr-001', 'chr-002', 'chr-003'],
  currentVersion
);
console.log(`DNA saved, version ${updatedDNA.version}`);
```

---

### 3. List Chromosome Library

**Operation**: Get all chromosomes in a holon's library

**Path Pattern**: `holons/{holonId}/chromosome_library`

**Method Signature**:
```typescript
function getChromosomeLibrary(
  holosphere: HoloSphere,
  holonId: string
): Promise<Chromosome[]>
```

**Input**:
- `holonId`: string (required) - The holon identifier

**Output**: Array of Chromosome objects
```typescript
[
  {
    id: string;
    holonId: string;
    name: string;
    type: 'value' | 'tool' | 'practice';
    description: string;
    createdAt: number;
    updatedAt: number;
    icon?: string;
    color?: string;
  },
  // ... more chromosomes
]
```

**Success Response**: Array of chromosomes (may be empty)
**Error Response**: Promise rejection with error message

**Access Control**: Holon administrators only

**Example**:
```typescript
const library = await getChromosomeLibrary(holosphere, 'holon-123');
const valueChromosomes = library.filter(c => c.type === 'value');
```

---

### 4. Add Chromosome to Library

**Operation**: Create a new chromosome in a holon's library

**Path Pattern**: `holons/{holonId}/chromosome_library/{chromosomeId}`

**Method Signature**:
```typescript
function addChromosome(
  holosphere: HoloSphere,
  holonId: string,
  chromosome: Omit<Chromosome, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Chromosome>
```

**Input**:
```typescript
{
  holonId: string;               // Required
  name: string;                  // Required, 1-100 chars, unique in library
  type: 'value' | 'tool' | 'practice';  // Required
  description: string;           // Required, 10-500 chars
  icon?: string;                 // Optional
  color?: string;                // Optional
}
```

**Validation**:
- `name` must be unique within the holon's library
- `description` must be 10-500 characters
- `type` must be one of: value, tool, practice

**Output**: Created Chromosome object with generated `id`, `createdAt`, `updatedAt`

**Success Response**: Chromosome object
**Validation Error**: Promise rejection with error details
**Duplicate Name Error**: Promise rejection indicating name conflict

**Access Control**: Holon administrators only

**Side Effects**:
- Generates UUID for `id`
- Sets `createdAt` and `updatedAt` timestamps
- Chromosome immediately available in library

**Example**:
```typescript
const newChromosome = await addChromosome(holosphere, 'holon-123', {
  holonId: 'holon-123',
  name: 'Transparency',
  type: 'value',
  description: 'We operate with full transparency in all our communications and decisions.',
  icon: 'eye'
});
console.log(`Created chromosome: ${newChromosome.id}`);
```

---

### 5. Update Chromosome

**Operation**: Edit an existing chromosome in the library

**Path Pattern**: `holons/{holonId}/chromosome_library/{chromosomeId}`

**Method Signature**:
```typescript
function updateChromosome(
  holosphere: HoloSphere,
  holonId: string,
  chromosomeId: string,
  updates: Partial<Pick<Chromosome, 'name' | 'description' | 'icon' | 'color'>>
): Promise<Chromosome>
```

**Input**:
- `chromosomeId`: string (required) - ID of chromosome to update
- `updates`: Partial chromosome fields to update

**Immutable Fields**: `id`, `holonId`, `type`, `createdAt`

**Validation**:
- If updating `name`, must remain unique within library
- If updating `description`, must be 10-500 characters

**Output**: Updated Chromosome object

**Success Response**: Updated chromosome
**Not Found Error**: Promise rejection if chromosome doesn't exist
**Validation Error**: Promise rejection with error details

**Access Control**: Holon administrators only

**Side Effects**:
- Updates `updatedAt` timestamp
- If chromosome is in DNA sequence, DNA viewers see updated info

**Example**:
```typescript
const updated = await updateChromosome(holosphere, 'holon-123', 'chr-001', {
  description: 'Updated description with more detail about this value.'
});
```

---

### 6. Remove Chromosome from Library

**Operation**: Delete a chromosome from the library

**Path Pattern**: `holons/{holonId}/chromosome_library/{chromosomeId}`

**Method Signature**:
```typescript
function removeChromosome(
  holosphere: HoloSphere,
  holonId: string,
  chromosomeId: string
): Promise<void>
```

**Input**:
- `chromosomeId`: string (required) - ID of chromosome to remove

**Output**: void (Promise resolves on success)

**Success Response**: Promise resolves
**Not Found**: Promise resolves (idempotent)
**In-Use Warning**: If chromosome is in DNA sequence, mark as archived rather than deleting

**Access Control**: Holon administrators only

**Side Effects**:
- Chromosome no longer appears in library
- If in DNA sequence, preserved but marked as archived/legacy
- Cannot be re-added to DNA sequences

**Example**:
```typescript
await removeChromosome(holosphere, 'holon-123', 'chr-001');
console.log('Chromosome removed from library');
```

---

### 7. Get Chromosome by ID

**Operation**: Retrieve a single chromosome by its ID

**Path Pattern**: `holons/{holonId}/chromosome_library/{chromosomeId}`

**Method Signature**:
```typescript
function getChromosome(
  holosphere: HoloSphere,
  holonId: string,
  chromosomeId: string
): Promise<Chromosome | null>
```

**Input**:
- `chromosomeId`: string (required) - ID of chromosome to retrieve

**Output**: Chromosome object or null

**Success Response**: Chromosome object
**Not Found**: null

**Access Control**: Public (needed to view DNA sequences)

**Example**:
```typescript
const chromosome = await getChromosome(holosphere, 'holon-123', 'chr-001');
if (chromosome) {
  console.log(`${chromosome.name}: ${chromosome.description}`);
}
```

---

## Real-Time Subscriptions

### Subscribe to DNA Sequence Changes

**Operation**: Listen for real-time updates to a holon's DNA

**Method Signature**:
```typescript
function subscribeToDNASequence(
  holosphere: HoloSphere,
  holonId: string,
  callback: (dna: DNASequence) => void
): () => void  // Returns unsubscribe function
```

**Behavior**:
- Callback fires immediately with current DNA state
- Callback fires on every update from any peer
- Returns unsubscribe function to stop listening

**Example**:
```typescript
const unsubscribe = subscribeToDNASequence(holosphere, 'holon-123', (dna) => {
  console.log(`DNA updated to version ${dna.version}`);
  updateUI(dna);
});

// Later, when component unmounts
unsubscribe();
```

---

### Subscribe to Chromosome Library Changes

**Operation**: Listen for real-time updates to the library

**Method Signature**:
```typescript
function subscribeToChromosomeLibrary(
  holosphere: HoloSphere,
  holonId: string,
  callback: (chromosome: Chromosome, isRemoved: boolean) => void
): () => void  // Returns unsubscribe function
```

**Behavior**:
- Callback fires for each existing chromosome on subscribe
- Callback fires when chromosomes are added/updated/removed
- `isRemoved` flag indicates deletion

**Example**:
```typescript
const unsubscribe = subscribeToChromosomeLibrary(
  holosphere,
  'holon-123',
  (chromosome, isRemoved) => {
    if (isRemoved) {
      removeFromLibraryUI(chromosome.id);
    } else {
      updateLibraryUI(chromosome);
    }
  }
);
```

---

## Error Handling

### Error Types

```typescript
export enum DNAErrorType {
  VALIDATION_ERROR = 'validation_error',
  NOT_FOUND = 'not_found',
  PERMISSION_DENIED = 'permission_denied',
  NETWORK_ERROR = 'network_error',
  CONFLICT = 'conflict'
}

export interface DNAError {
  type: DNAErrorType;
  message: string;
  details?: any;
}
```

### Common Error Responses

**Validation Error**:
```typescript
{
  type: 'validation_error',
  message: 'Invalid DNA sequence',
  details: {
    errors: [
      'Maximum 20 chromosomes allowed',
      'Duplicate chromosome ID: chr-001'
    ]
  }
}
```

**Permission Denied**:
```typescript
{
  type: 'permission_denied',
  message: 'Holon administrator access required to modify DNA'
}
```

**Network Error**:
```typescript
{
  type: 'network_error',
  message: 'Unable to connect to holosphere',
  details: {
    queued: true,  // Save queued for later
    retryAt: timestamp
  }
}
```

---

## Offline Support

### Queued Operations

When holosphere connection is lost:
1. Saves are queued in local storage
2. User sees "Saving offline" indicator
3. On reconnection, queued saves are flushed
4. User notified of sync completion

**Queue Structure**:
```typescript
interface QueuedOperation {
  operation: 'save_dna' | 'add_chromosome' | 'update_chromosome' | 'remove_chromosome';
  holonId: string;
  data: any;
  timestamp: number;
  retryCount: number;
}
```

---

## Performance Expectations

| Operation | Target Latency | Notes |
|-----------|----------------|-------|
| Read DNA Sequence | <500ms | First load, then cached |
| Write DNA Sequence | <1s | Local immediate, sync async |
| List Library | <500ms | Cached after first load |
| Add Chromosome | <1s | Local immediate, sync async |
| Realtime Update | <200ms | Peer-to-peer propagation |

---

## Testing Contracts

Integration tests should verify:
1. ✅ DNA sequence CRUD operations
2. ✅ Chromosome library CRUD operations
3. ✅ Real-time synchronization between peers
4. ✅ Validation enforcement
5. ✅ Conflict resolution (last-write-wins)
6. ✅ Offline queue and retry logic
7. ✅ Access control enforcement
8. ✅ Error handling for all failure modes

See `tests/integration/holosphere-sync.test.ts` for implementation.
