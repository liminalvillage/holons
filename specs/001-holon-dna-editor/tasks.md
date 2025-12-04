# Tasks: Holon DNA Editor

**Input**: Design documents from `/specs/001-holon-dna-editor/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Tests are NOT explicitly requested in the feature specification. Test tasks have been excluded per template guidelines.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/`, `doc/` at repository root
- Paths shown below follow SvelteKit conventions per plan.md

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Install svelte-dnd-action dependency via npm
- [X] T002 [P] Create TypeScript types file in src/lib/dna/types.ts with Chromosome, DNASequence, ChromosomeType interfaces
- [X] T003 [P] Create JSON schema for Chromosome in src/components/schemas/chromosome.schema.json
- [X] T004 [P] Create JSON schema for DNASequence in src/components/schemas/dna-sequence.schema.json
- [X] T005 Register chromosome and dna-sequence schemas in src/lib/schemas.ts
- [X] T006 [P] Create field configuration for chromosome forms in src/components/fields/ (chromosome-name.json, chromosome-type.json, chromosome-description.json)
- [X] T007 [P] Create field configuration for DNA forms in src/components/fields/ (covered by existing field definitions)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T008 Create validation logic in src/lib/dna/validation.ts with validateDNASequence and validateChromosome functions
- [X] T009 Create holosphere operations in src/lib/dna/holosphere.ts with getDNASequence function
- [X] T010 Add saveDNASequence function to src/lib/dna/holosphere.ts
- [X] T011 Add getChromosomeLibrary function to src/lib/dna/holosphere.ts
- [X] T012 Add addChromosome function to src/lib/dna/holosphere.ts
- [X] T013 Add updateChromosome function to src/lib/dna/holosphere.ts
- [X] T014 Add removeChromosome function to src/lib/dna/holosphere.ts
- [X] T015 Add getChromosome function to src/lib/dna/holosphere.ts
- [X] T016 Add subscribeToDNASequence real-time subscription function to src/lib/dna/holosphere.ts
- [X] T017 Add subscribeToChromosomeLibrary real-time subscription function to src/lib/dna/holosphere.ts
- [X] T018 [P] Create Svelte stores for DNA editor state in src/lib/stores/dna-editor.ts
- [X] T019 [P] Create error handling utilities in src/lib/dna/errors.ts with DNAError types and handlers

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - View and Select Chromosomes from Library (Priority: P1) 🎯 MVP

**Goal**: Enable holon administrators to browse and select chromosomes from a categorized library

**Independent Test**: Load the DNA editor for a holon, verify chromosome library displays with categories (values/tools/practices), select chromosomes and verify they're added to the DNA sequence

### Implementation for User Story 1

- [X] T020 [P] [US1] Create ChromosomeCard component in src/components/ChromosomeCard.svelte displaying name, description, type badge, and optional icon
- [X] T021 [P] [US1] Create ChromosomeLibrary component in src/components/ChromosomeLibrary.svelte with categorized chromosome display
- [X] T022 [US1] Add chromosome selection logic to ChromosomeLibrary component (onclick handler to add to DNA sequence)
- [X] T023 [US1] Add category filtering UI to ChromosomeLibrary component (tabs or buttons for values/tools/practices)
- [X] T024 [US1] Implement real-time library subscription in ChromosomeLibrary component using subscribeToChromosomeLibrary (deferred to Phase 5)
- [X] T025 [P] [US1] Create basic DNASequence component in src/components/DNASequence.svelte to display selected chromosomes (no drag-drop yet)
- [X] T026 [US1] Add chromosome removal functionality to DNASequence component (click to remove)
- [X] T027 [US1] Create main DNAEditor component in src/components/DNAEditor.svelte integrating ChromosomeLibrary and DNASequence
- [X] T028 [US1] Implement holosphere context retrieval in DNAEditor using getContext('holosphere')
- [X] T029 [US1] Add initial data loading in DNAEditor (load library and DNA sequence on mount)
- [X] T030 [US1] Create DNA editor route page in src/routes/[id]/dna/+page.svelte that renders DNAEditor with holonId from params
- [X] T031 [US1] Add TailwindCSS styling to ChromosomeCard matching existing Harvest card patterns (shadow, hover effects, transitions)
- [X] T032 [US1] Add responsive layout to DNAEditor (sidebar for library, main area for sequence, collapsible on mobile)
- [X] T033 [US1] Implement empty state UI for ChromosomeLibrary when no chromosomes exist
- [X] T034 [US1] Implement empty state UI for DNASequence when no chromosomes selected
- [X] T035 [US1] Add duplicate prevention logic to chromosome selection (prevent adding same chromosome twice)

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently. Users can browse the library, select chromosomes, and see them in a basic DNA sequence display.

---

## Phase 4: User Story 2 - Compose and Reorder DNA Sequence (Priority: P2)

**Goal**: Enable drag-and-drop reordering of chromosomes within the DNA sequence

**Independent Test**: Add 5-10 chromosomes to a DNA sequence, drag them to different positions, verify order updates correctly and persists visual state

### Implementation for User Story 2

- [X] T036 [US2] Integrate svelte-dnd-action dndzone directive into DNASequence component
- [X] T037 [US2] Implement handleDndConsider event handler in DNASequence component for drag preview
- [X] T038 [US2] Implement handleDndFinalize event handler in DNASequence component to update order on drop
- [X] T039 [US2] Add visual drag handles to chromosome items in DNASequence component
- [X] T040 [US2] Implement smooth animations for reordering using svelte-dnd-action flipDurationMs parameter
- [X] T041 [US2] Add insertion point selection UI for adding chromosomes at specific positions (handled by drag-and-drop)
- [X] T042 [US2] Update chromosome removal to maintain relative order of remaining chromosomes
- [X] T043 [US2] Add accessibility features to drag-and-drop (keyboard navigation, ARIA labels)
- [X] T044 [US2] Optimize drag performance for sequences up to 20 chromosomes (60fps target)
- [X] T045 [US2] Add visual feedback during drag operations (highlight drop zones, dimming)

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently. Users can select, reorder, and organize their DNA sequence with smooth drag-and-drop interaction.

---

## Phase 5: User Story 3 - Save and Persist DNA to Holosphere (Priority: P3)

**Goal**: Enable saving DNA sequences to holosphere with offline support and conflict resolution

**Independent Test**: Compose a DNA sequence, click save, verify success message. Close and reopen editor, verify sequence persists. Test offline mode by disconnecting network, saving, reconnecting, and verifying sync.

### Implementation for User Story 3

- [X] T046 [US3] Add save button to DNAEditor component with loading state indicator
- [X] T047 [US3] Implement save handler in DNAEditor that calls saveDNASequence with current chromosome IDs
- [X] T048 [US3] Add validation before save (max 20 chromosomes, no duplicates, all exist in library)
- [X] T049 [US3] Display validation errors to user if save fails validation
- [X] T050 [US3] Implement optimistic UI updates (immediately reflect save, rollback on error)
- [X] T051 [US3] Add save success notification/toast message
- [X] T052 [US3] Add save error notification/toast message with retry option
- [ ] T053 [US3] Implement offline queue in holosphere.ts for saves when disconnected (deferred - needs holosphere API clarification)
- [X] T054 [US3] Add connection status indicator to DNAEditor (online/offline/syncing)
- [ ] T055 [US3] Implement automatic retry logic for queued saves on reconnection (deferred - needs holosphere API clarification)
- [X] T056 [US3] Add version tracking to detect and handle concurrent edit conflicts
- [X] T057 [US3] Implement last-write-wins conflict resolution with warning notification
- [ ] T058 [US3] Add "review current state" button to conflict warning notification (deferred)
- [X] T059 [US3] Implement DNA sequence loading on editor mount via getDNASequence
- [X] T060 [US3] Add real-time sync subscription via subscribeToDNASequence to update UI when other users save
- [X] T061 [US3] Handle edge case when library chromosome is deleted but exists in DNA (filtered in sequence display)

**Checkpoint**: All user stories should now be independently functional. Users can select, reorder, save, and persist DNA sequences with full holosphere integration and offline support.

---

## Phase 6: User Story 4 - View DNA in Beautiful Visual Interface (Priority: P4)

**Goal**: Polish the visual presentation with DNA-inspired design elements

**Independent Test**: Compose a DNA sequence, evaluate visual appeal, check color coding for chromosome types, verify smooth scrolling and hover effects, test on tablet device

### Implementation for User Story 4

- [ ] T062 [P] [US4] Design and implement DNA helix visual metaphor for sequence display (consider using CSS animations or SVG)
- [ ] T063 [P] [US4] Add chromosome type color coding (blue for values, green for tools, purple for practices)
- [ ] T064 [P] [US4] Implement icon display for chromosomes using svelte-feather-icons or emoji
- [ ] T065 [US4] Add smooth scroll behavior for long DNA sequences
- [ ] T066 [US4] Implement hover effects on ChromosomeCard (scale, shadow enhancement, transition)
- [ ] T067 [US4] Add tooltip or popover for detailed chromosome information on hover
- [ ] T068 [US4] Implement smooth transitions for adding/removing chromosomes (fade in/out)
- [ ] T069 [US4] Add loading skeleton UI while DNA sequence loads from holosphere
- [ ] T070 [US4] Polish sidebar collapse/expand animation for library
- [ ] T071 [US4] Add subtle DNA-themed background pattern or texture
- [ ] T072 [US4] Implement dark mode support following existing Harvest color schemes
- [ ] T073 [US4] Optimize mobile/tablet layout (stack library above sequence on small screens)
- [ ] T074 [US4] Add micro-interactions (button press effects, selection highlights, drag indicators)

**Checkpoint**: All user stories complete with polished, beautiful interface that enhances user engagement and understanding.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories and final documentation

- [ ] T075 [P] Create README.md in doc/holon-dna-editor/ with feature overview and usage guide
- [ ] T076 [P] Create integration.md in doc/holon-dna-editor/ documenting holosphere integration patterns
- [ ] T077 [P] Create examples.md in doc/holon-dna-editor/ with example chromosome definitions
- [ ] T078 Add JSDoc comments to complex functions in holosphere.ts and validation.ts
- [ ] T079 [P] Verify TypeScript compilation with yarn check
- [ ] T080 [P] Run ESLint and Prettier with yarn lint and fix any issues
- [ ] T081 Test complete workflow manually (select, reorder, save, reload, verify persistence)
- [ ] T082 Test offline mode (disconnect network, make changes, reconnect, verify sync)
- [ ] T083 Test concurrent editing (open two browser tabs, edit same DNA, verify last-write-wins)
- [ ] T084 Performance test with 20 chromosomes in DNA sequence (verify smooth 60fps drag-and-drop)
- [ ] T085 Performance test with 50+ chromosomes in library (verify instant browsing)
- [ ] T086 Accessibility audit (keyboard navigation, screen reader compatibility, ARIA labels)
- [ ] T087 Responsive design test on tablet device (verify touch drag-and-drop works)
- [ ] T088 Cross-browser testing (Chrome, Firefox, Safari on desktop and mobile)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational phase completion - No dependencies on other stories
- **User Story 2 (Phase 4)**: Depends on Foundational phase completion - Builds on User Story 1 (DNASequence component)
- **User Story 3 (Phase 5)**: Depends on Foundational phase completion - Builds on User Story 1 and 2
- **User Story 4 (Phase 6)**: Depends on Foundational phase completion - Enhances all previous stories
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Modifies DNASequence component from US1 but can be developed independently in parallel
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Uses components from US1/US2 but adds separate save functionality
- **User Story 4 (P4)**: Can start after Foundational (Phase 2) - Purely visual enhancements, can be developed in parallel

### Within Each User Story

- Components marked [P] can run in parallel (different files)
- Foundation tasks (T008-T019) must complete before user story work
- US1 components can be built in parallel: ChromosomeCard, ChromosomeLibrary (basics), DNASequence (basics)
- US2 builds on DNASequence but can be developed independently
- US3 adds save logic independently
- US4 adds visual polish independently

### Parallel Opportunities

- **Setup (Phase 1)**: T002, T003, T004 can run in parallel (different files)
- **Setup (Phase 1)**: T006, T007 can run in parallel
- **Foundational (Phase 2)**: T018, T019 can run in parallel
- **User Story 1**: T020, T021, T025 can run in parallel (separate components)
- **User Story 4**: T062, T063, T064 can run in parallel (visual enhancements)
- **Polish**: T075, T076, T077, T079, T080 can run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch foundational infrastructure tasks together:
Task: "Create validation logic in src/lib/dna/validation.ts"
Task: "Create Svelte stores in src/lib/stores/dna-editor.ts"
Task: "Create error utilities in src/lib/dna/errors.ts"

# Then launch US1 component tasks together:
Task: "Create ChromosomeCard in src/components/ChromosomeCard.svelte"
Task: "Create ChromosomeLibrary in src/components/ChromosomeLibrary.svelte"
Task: "Create DNASequence in src/components/DNASequence.svelte"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T007)
2. Complete Phase 2: Foundational (T008-T019) - CRITICAL - blocks all stories
3. Complete Phase 3: User Story 1 (T020-T035)
4. **STOP and VALIDATE**: Test User Story 1 independently
   - Load editor for a holon
   - Verify library displays with categories
   - Select chromosomes
   - Verify they appear in DNA sequence
   - Remove chromosomes
   - Verify empty states
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test drag-and-drop → Deploy/Demo
4. Add User Story 3 → Test persistence and offline → Deploy/Demo
5. Add User Story 4 → Test visual polish → Deploy/Demo
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together (T001-T019)
2. Once Foundational is done:
   - Developer A: User Story 1 (T020-T035) - Core selection UI
   - Developer B: User Story 2 (T036-T045) - Drag-and-drop (after US1 components exist)
   - Developer C: User Story 3 (T046-T061) - Persistence (after US1 components exist)
   - Developer D: User Story 4 (T062-T074) - Visual polish (can start in parallel)
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Tests are not included as they were not explicitly requested in spec.md
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
