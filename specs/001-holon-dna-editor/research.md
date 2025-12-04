# Research: Holon DNA Editor

**Date**: 2025-10-26
**Feature**: 001-holon-dna-editor

## Overview

This document resolves technical unknowns identified in the Technical Context section of the implementation plan.

## Research Questions

### 1. Drag-and-Drop Library Selection

**Question**: Which drag-and-drop library should be used for chromosome reordering in Svelte 5?

**Options Evaluated**:

1. **svelte-dnd-action** (https://github.com/isaacHagoel/svelte-dnd-action)
   - Pros: Svelte-specific, good touch support, accessible
   - Cons: May need updates for Svelte 5 compatibility

2. **@dnd-kit/core** (https://dndkit.com/)
   - Pros: Framework-agnostic, excellent accessibility, modular
   - Cons: Requires Svelte wrapper, larger bundle size

3. **Native HTML5 Drag and Drop API**
   - Pros: Zero dependencies, native browser support
   - Cons: Poor touch support, accessibility challenges, inconsistent mobile behavior

**Decision**: svelte-dnd-action

**Rationale**:
- Native Svelte integration with minimal boilerplate
- Proven track record in Svelte applications
- Good touch support critical for tablet users (per spec requirement)
- Accessibility features built-in
- Smaller bundle size than @dnd-kit
- Active maintenance with Svelte 5 compatibility updates in progress
- Smooth animations and transitions align with "beautiful interface" requirement

**Alternatives Considered**:
- @dnd-kit rejected due to framework-agnostic overhead and larger bundle
- Native HTML5 rejected due to poor mobile/touch support required for tablet devices

**Implementation Notes**:
- Use `dndzone` directive on DNA sequence container
- Handle `consider` and `finalize` events for reordering
- Implement custom drag handles for accessibility
- Add visual feedback during drag operations

---

### 2. Integration Testing Strategy for Holosphere Synchronization

**Question**: How should integration tests validate holosphere synchronization behavior?

**Approach Evaluated**:

1. **Mock Holosphere Instance**
   - Create test doubles that simulate holosphere behavior
   - Fast execution, deterministic results
   - May not catch real synchronization issues

2. **In-Memory Gun Instance**
   - Use actual Gun/holosphere with in-memory storage
   - Real holosphere behavior without network dependency
   - Closer to production but slower tests

3. **Test Network with Multiple Peers**
   - Full peer-to-peer testing with multiple holosphere instances
   - Most realistic but complex setup

**Decision**: Hybrid approach - In-Memory Gun Instance for integration tests + Mock for unit tests

**Rationale**:
- Integration tests should use real holosphere with in-memory Gun storage
- Validates actual GunDB patterns and real-time synchronization logic
- Fast enough for CI/CD pipelines (no network I/O)
- Unit tests can use mocks for component isolation
- Covers the critical holosphere integration risk without excessive complexity

**Test Scenarios to Cover**:
1. Save DNA sequence → verify persisted to holosphere
2. Load DNA sequence → verify retrieved correctly
3. Concurrent edits → verify last-write-wins behavior
4. Connection loss → verify queued saves
5. Connection restore → verify queued saves flush
6. Library add/edit/remove → verify holosphere updates

**Implementation Notes**:
```typescript
// Example test setup
import Gun from 'gun';
import { HoloSphere } from 'holosphere';

// In-memory Gun for tests
const gun = Gun({ localStorage: false, radisk: false });
const testHolosphere = new HoloSphere({ gun });
```

**Alternatives Considered**:
- Pure mocking rejected as too disconnected from real holosphere behavior
- Full network testing rejected as too slow and complex for regular CI/CD

---

## Additional Research Findings

### Svelte 5 Considerations

**Finding**: Svelte 5 introduces new reactivity model with runes ($state, $derived, $effect)

**Impact on Implementation**:
- Use `$state` for DNA sequence and library data
- Use `$derived` for computed values (e.g., filtered chromosomes, validation status)
- Use `$effect` for holosphere synchronization side effects
- Leverage improved TypeScript inference

**Example Pattern**:
```typescript
let dnaSequence = $state<Chromosome[]>([]);
let isValid = $derived(dnaSequence.length <= 20 && hasUniqueChromosomes(dnaSequence));

$effect(() => {
  // Sync to holosphere when dnaSequence changes
  saveDNAToHolosphere(currentHolon, dnaSequence);
});
```

### TailwindCSS Patterns in Harvest

**Finding**: Existing Harvest components use consistent patterns

**Observed Patterns**:
- Card-based layouts with shadow and hover effects
- Sidebar/main content split
- Color scheme: blues for primary actions, grays for neutral elements
- Icon usage via svelte-feather-icons
- Responsive breakpoints: `md:` for tablet, `lg:` for desktop
- Transitions using `transition-all duration-200 ease-in-out`

**Application to DNA Editor**:
- Chromosome cards should follow existing card styling
- DNA sequence as main content area, library as sidebar (collapsible)
- Use existing color tokens for chromosome type distinction (values/tools/practices)
- Drag handles and visual feedback using existing transition patterns

### Holosphere Data Structure Patterns

**Finding**: Existing Harvest holosphere usage patterns

**Observed Patterns**:
```typescript
// Typical holosphere path structure
holosphere.get('holons').get(holonId).get('property')

// For collections
holosphere.get('holons').get(holonId).get('collection').map()
```

**Recommended Structure for DNA**:
```typescript
// Chromosome library per holon
holosphere.get('holons').get(holonId).get('chromosome_library').map()

// DNA sequence per holon
holosphere.get('holons').get(holonId).get('dna_sequence')
```

## Summary

All technical unknowns have been resolved:

1. ✅ **Drag-and-drop library**: svelte-dnd-action selected for Svelte-native integration and touch support
2. ✅ **Integration testing**: Hybrid approach using in-memory Gun instances for realistic holosphere testing without network overhead

Additional research provided implementation guidance for Svelte 5 reactivity, TailwindCSS styling consistency, and holosphere data structure patterns.

## Next Steps

Proceed to Phase 1:
- Generate data-model.md with entity definitions
- Create contracts for holosphere data operations
- Write quickstart.md with setup and usage instructions
