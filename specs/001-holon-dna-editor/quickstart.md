# Quickstart: Holon DNA Editor

**Feature**: 001-holon-dna-editor
**Date**: 2025-10-26

## Overview

This guide helps developers set up, develop, and test the Holon DNA Editor feature. Follow these steps to get started quickly.

## Prerequisites

- Node.js 20+ installed
- Yarn package manager
- Git repository cloned
- Branch `001-holon-dna-editor` checked out
- Basic familiarity with Svelte 5, TypeScript, and holosphere library

## Installation

### 1. Install Dependencies

```bash
# Install project dependencies (if not already done)
yarn install

# Install feature-specific dependency
yarn add svelte-dnd-action
```

### 2. Verify Development Environment

```bash
# Run type checking
yarn check

# Run linter
yarn lint

# Start development server
yarn dev
```

The dev server should start at `http://localhost:5173` (or next available port).

## Project Structure

```
src/
├── components/
│   ├── DNAEditor.svelte               # Main component
│   ├── ChromosomeLibrary.svelte       # Library sidebar
│   ├── DNASequence.svelte             # Sequence display
│   ├── ChromosomeCard.svelte          # Individual chromosome
│   ├── schemas/
│   │   ├── chromosome.schema.json
│   │   └── dna-sequence.schema.json
│   └── fields/
│       ├── chromosome-fields.ts
│       └── dna-fields.ts
├── lib/
│   ├── dna/
│   │   ├── types.ts                   # TypeScript types
│   │   ├── validation.ts              # Validation logic
│   │   └── holosphere.ts              # Holosphere operations
│   └── stores/
│       └── dna-editor.ts              # State management
└── routes/
    └── [id]/
        └── dna/
            └── +page.svelte           # DNA editor page

tests/
├── unit/
│   ├── dna-validation.test.ts
│   └── dna-editor.test.ts
├── integration/
│   └── holosphere-sync.test.ts
└── contract/
    └── dna-schema.test.ts

doc/
└── holon-dna-editor/
    ├── README.md
    ├── integration.md
    └── examples.md
```

## Development Workflow

### Phase 1: Set Up Types and Schemas (User Story P1 Foundation)

**Goal**: Define data structures before building UI

1. **Create TypeScript types** (`src/lib/dna/types.ts`):
```typescript
export type ChromosomeType = 'value' | 'tool' | 'practice';

export interface Chromosome {
  id: string;
  holonId: string;
  name: string;
  type: ChromosomeType;
  description: string;
  createdAt: number;
  updatedAt: number;
  icon?: string;
  color?: string;
}

export interface DNASequence {
  holonId: string;
  chromosomeIds: string[];
  createdAt: number;
  updatedAt: number;
  version: number;
}
```

2. **Create JSON schemas** (`src/components/schemas/`):
   - `chromosome.schema.json` - Define chromosome validation rules
   - `dna-sequence.schema.json` - Define DNA sequence validation rules

3. **Register schemas** in `src/lib/schemas.ts`:
```typescript
import chromosomeSchema from '../components/schemas/chromosome.schema.json';
import dnaSequenceSchema from '../components/schemas/dna-sequence.schema.json';

export const schemas = {
  // ... existing schemas
  'chromosome': chromosomeSchema,
  'dna-sequence': dnaSequenceSchema
};
```

4. **Verify**: Run `yarn check` to ensure types compile

### Phase 2: Implement Holosphere Integration (User Story P1 + P3)

**Goal**: Build data layer before UI

1. **Create holosphere operations** (`src/lib/dna/holosphere.ts`):
```typescript
import type { HoloSphere } from 'holosphere';
import type { Chromosome, DNASequence } from './types';

export async function getDNASequence(
  holosphere: HoloSphere,
  holonId: string
): Promise<DNASequence | null> {
  return new Promise((resolve) => {
    holosphere
      .get('holons')
      .get(holonId)
      .get('dna_sequence')
      .once((data) => {
        resolve(data || null);
      });
  });
}

export async function saveDNASequence(
  holosphere: HoloSphere,
  holonId: string,
  chromosomeIds: string[],
  currentVersion?: number
): Promise<DNASequence> {
  const dna: DNASequence = {
    holonId,
    chromosomeIds,
    updatedAt: Date.now(),
    version: (currentVersion || 0) + 1,
    createdAt: Date.now() // Will be overwritten if exists
  };

  return new Promise((resolve, reject) => {
    holosphere
      .get('holons')
      .get(holonId)
      .get('dna_sequence')
      .put(dna, (ack) => {
        if (ack.err) reject(new Error(ack.err));
        else resolve(dna);
      });
  });
}

// Add getChromosomeLibrary, addChromosome, etc.
```

2. **Create validation logic** (`src/lib/dna/validation.ts`):
```typescript
import type { DNASequence, Chromosome } from './types';

export function validateDNASequence(
  sequence: DNASequence,
  library: Chromosome[]
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Max 20 chromosomes
  if (sequence.chromosomeIds.length > 20) {
    errors.push('Maximum 20 chromosomes allowed');
  }

  // No duplicates
  const uniqueIds = new Set(sequence.chromosomeIds);
  if (uniqueIds.size !== sequence.chromosomeIds.length) {
    errors.push('Duplicate chromosomes not allowed');
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
```

3. **Write integration tests** (`tests/integration/holosphere-sync.test.ts`):
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Gun from 'gun';
import { HoloSphere } from 'holosphere';
import { saveDNASequence, getDNASequence } from '$lib/dna/holosphere';

describe('Holosphere DNA Sync', () => {
  let holosphere: HoloSphere;

  beforeEach(() => {
    const gun = Gun({ localStorage: false, radisk: false });
    holosphere = new HoloSphere({ gun });
  });

  it('should save and retrieve DNA sequence', async () => {
    const holonId = 'test-holon-1';
    const chromosomeIds = ['chr-1', 'chr-2', 'chr-3'];

    await saveDNASequence(holosphere, holonId, chromosomeIds);
    const retrieved = await getDNASequence(holosphere, holonId);

    expect(retrieved).toBeDefined();
    expect(retrieved?.chromosomeIds).toEqual(chromosomeIds);
    expect(retrieved?.version).toBe(1);
  });
});
```

4. **Run tests**: `yarn test tests/integration/holosphere-sync.test.ts`

### Phase 3: Build UI Components (User Story P1 - MVP)

**Goal**: Create chromosome library browsing and selection

1. **Create ChromosomeCard component** (`src/components/ChromosomeCard.svelte`):
```svelte
<script lang="ts">
  import type { Chromosome } from '$lib/dna/types';

  interface Props {
    chromosome: Chromosome;
    onSelect?: (id: string) => void;
    selected?: boolean;
  }

  let { chromosome, onSelect, selected = false }: Props = $props();
</script>

<button
  class="card p-4 hover:shadow-lg transition-all duration-200"
  class:ring-2={selected}
  onclick={() => onSelect?.(chromosome.id)}
>
  <div class="flex items-start gap-3">
    {#if chromosome.icon}
      <span class="text-2xl">{chromosome.icon}</span>
    {/if}
    <div class="flex-1">
      <h3 class="font-semibold text-lg">{chromosome.name}</h3>
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {chromosome.description}
      </p>
      <span class="text-xs badge badge-{chromosome.type}">
        {chromosome.type}
      </span>
    </div>
  </div>
</button>

<style>
  .card {
    @apply bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700;
  }
  .badge {
    @apply inline-block px-2 py-1 rounded-full;
  }
  .badge-value {
    @apply bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200;
  }
  .badge-tool {
    @apply bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200;
  }
  .badge-practice {
    @apply bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200;
  }
</style>
```

2. **Create ChromosomeLibrary component** (`src/components/ChromosomeLibrary.svelte`)
3. **Create DNASequence component** (`src/components/DNASequence.svelte`) - defer drag-drop for now
4. **Create main DNAEditor component** (`src/components/DNAEditor.svelte`)

5. **Add route page** (`src/routes/[id]/dna/+page.svelte`):
```svelte
<script lang="ts">
  import { getContext } from 'svelte';
  import type { HoloSphere } from 'holosphere';
  import DNAEditor from '$components/DNAEditor.svelte';
  import { page } from '$app/stores';

  const holosphere = getContext<HoloSphere>('holosphere');
  const holonId = $derived($page.params.id);
</script>

<DNAEditor {holosphere} {holonId} />
```

6. **Test manually**: Navigate to `http://localhost:5173/{holonId}/dna`

### Phase 4: Add Drag-and-Drop (User Story P2)

**Goal**: Enable chromosome reordering

1. **Install svelte-dnd-action** (if not done): `yarn add svelte-dnd-action`

2. **Update DNASequence component** with drag-and-drop:
```svelte
<script lang="ts">
  import { dndzone } from 'svelte-dnd-action';
  import type { Chromosome } from '$lib/dna/types';

  let { sequence, onReorder }: { sequence: Chromosome[], onReorder: (newOrder: Chromosome[]) => void } = $props();

  let items = $state(sequence);

  function handleDndConsider(e: CustomEvent) {
    items = e.detail.items;
  }

  function handleDndFinalize(e: CustomEvent) {
    items = e.detail.items;
    onReorder(items);
  }
</script>

<div
  use:dndzone={{items, flipDurationMs: 200}}
  on:consider={handleDndConsider}
  on:finalize={handleDndFinalize}
  class="dna-sequence"
>
  {#each items as chromosome (chromosome.id)}
    <div class="chromosome-item">
      <ChromosomeCard {chromosome} />
    </div>
  {/each}
</div>
```

3. **Test drag-and-drop**: Verify smooth reordering at 60fps

### Phase 5: Complete Persistence (User Story P3)

**Goal**: Save to holosphere and handle offline

1. **Add save functionality** to DNAEditor
2. **Implement offline queue** in holosphere.ts
3. **Add connection status indicator**
4. **Test**: Save, go offline, save again, reconnect, verify sync

### Phase 6: Polish UI (User Story P4)

**Goal**: Beautiful DNA visualization

1. **Add DNA helix visual metaphor**
2. **Implement smooth transitions**
3. **Add hover effects and tooltips**
4. **Test on tablet devices**

## Running Tests

```bash
# Run all tests
yarn test

# Run specific test file
yarn test tests/unit/dna-validation.test.ts

# Run with coverage
yarn test --coverage

# Watch mode
yarn test --watch
```

## Common Tasks

### Add a New Chromosome Type

1. Update `ChromosomeType` in `src/lib/dna/types.ts`
2. Update validation in `src/lib/dna/validation.ts`
3. Add badge style in `ChromosomeCard.svelte`
4. Update schema in `chromosome.schema.json`

### Debug Holosphere Sync Issues

1. Check browser console for Gun logs
2. Use Gun's debug mode: `Gun({ ... }, {debug: true})`
3. Verify holosphere paths match contract
4. Check network tab for peer connections

### Test with Multiple Holons

1. Open multiple browser tabs
2. Navigate each to different holon DNA editor
3. Verify isolation (each holon has own library)
4. Test cross-holon DNA viewing (public read)

## Troubleshooting

### "holosphere is undefined"

**Solution**: Ensure holosphere context is set in parent layout:
```typescript
// In +layout.svelte or parent component
import { setContext } from 'svelte';
import { holosphere } from '$lib/holosphere-instance';

setContext('holosphere', holosphere);
```

### Drag-and-drop not working on mobile

**Solution**: Ensure svelte-dnd-action is configured for touch:
```typescript
use:dndzone={{items, flipDurationMs: 200, dragDisabled: false}}
```

### DNA not saving

**Solution**: Check validation errors and holosphere connection:
```typescript
const validation = validateDNASequence(dna, library);
if (!validation.isValid) {
  console.error('Validation errors:', validation.errors);
}
```

## Next Steps

After completing the quickstart:
1. Review [data-model.md](./data-model.md) for full entity specifications
2. Review [contracts/holosphere-operations.md](./contracts/holosphere-operations.md) for API details
3. Run `/speckit.tasks` to generate the detailed task breakdown
4. Begin implementation following task order

## Resources

- [Svelte 5 Documentation](https://svelte-5-preview.vercel.app/docs)
- [holosphere Documentation](https://github.com/holochain/holosphere)
- [svelte-dnd-action](https://github.com/isaacHagoel/svelte-dnd-action)
- [TailwindCSS Documentation](https://tailwindcss.com/docs)
- [Vitest Documentation](https://vitest.dev/)

## Support

For questions or issues:
1. Check existing Harvest components for patterns
2. Review constitution compliance requirements
3. Consult team documentation in `doc/holon-dna-editor/`
