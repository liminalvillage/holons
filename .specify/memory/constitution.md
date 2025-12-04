<!--
Sync Impact Report:
- Version: 0.0.0 → 1.0.0 (Initial constitution creation)
- Rationale: First constitution establishing governance for Harvest project
- Modified principles: N/A (new creation)
- Added sections: All core principles, development workflow, governance
- Removed sections: N/A
- Templates status:
  ✅ plan-template.md - Constitution Check section aligns with Component Architecture and Testing principles
  ✅ spec-template.md - User Scenarios format aligns with User-Centered Design principle
  ✅ tasks-template.md - Task organization aligns with Incremental Delivery principle
- Follow-up TODOs: None
-->

# Harvest Constitution

## Core Principles

### I. Component Architecture

Every feature MUST be implemented as a standalone Svelte component that integrates with the existing project structure.

**Rules**:
- Components are self-contained and reusable
- New components MUST NOT modify existing components unless explicitly required
- Components MUST use TypeScript for type safety
- Components MUST follow existing TailwindCSS styling patterns
- Components MUST access holosphere instance via Svelte context: `getContext('holosphere')`

**Rationale**: The holonic dashboard requires modular, composable components that can evolve independently without cascading changes across the codebase.

### II. Data Persistence via Holosphere

All data operations MUST use the holosphere library for decentralized data synchronization.

**Rules**:
- Components MUST retrieve holosphere instance from Svelte context, never instantiate directly
- Data reads/writes MUST use GunDB patterns through holosphere
- Components MUST handle real-time updates from peer-to-peer synchronization
- Environment-specific holosphere configurations MUST be respected (HolonsDebug for development, Holons for production)

**Rationale**: The project is built on decentralized holonic networks requiring consistent data layer usage across all components.

### III. Schema-Driven Design

Features involving structured data MUST use or extend the existing JSON schema system.

**Rules**:
- New entity types MUST define schemas in `src/components/schemas/`
- Schemas MUST be versioned and registered in `src/lib/schemas.ts`
- Use `SchemaForm.svelte` for dynamic form generation from schemas
- Field configurations MUST be placed in `src/components/fields/`

**Rationale**: The application's schema registry ensures consistent data structures across the holonic network and enables automatic form generation.

### IV. Documentation & Testing

Components MUST include documentation and tests in designated directories.

**Rules**:
- Documentation MUST be placed in `doc/` folder at repository root
- Tests MUST be placed in `tests/` folder
- Components SHOULD include inline JSDoc comments for complex logic
- Documentation MUST describe integration with holosphere and usage examples

**Rationale**: Proper documentation and testing ensure components can be understood, maintained, and validated by the team and community.

### V. User-Centered Design

Features MUST be designed around user scenarios with clear acceptance criteria.

**Rules**:
- Specifications MUST define user stories with Given-When-Then acceptance scenarios
- User stories MUST be prioritized (P1, P2, P3) by value
- Each user story MUST be independently testable
- Edge cases and error scenarios MUST be documented

**Rationale**: Holonic network interfaces must serve real user needs with measurable success criteria to validate feature effectiveness.

### VI. Incremental Delivery

Features MUST be implemented in independently deliverable increments.

**Rules**:
- User Story 1 (P1) MUST deliver a functional MVP
- Each subsequent user story MUST add value without breaking previous stories
- Tasks MUST be organized by user story to enable parallel development
- Checkpoints MUST validate story independence before proceeding

**Rationale**: The holonic network benefits from iterative value delivery, allowing user feedback to guide development priorities.

## Development Workflow

### File Organization

- **Components**: `src/components/` for reusable Svelte components
- **Routes**: `src/routes/` for SvelteKit file-based routing
- **Dashboard**: `src/dashboard/` for dashboard-specific components (Layout, TopBar, Sidebar, Overlay)
- **Schemas**: `src/components/schemas/` for JSON schema definitions
- **Fields**: `src/components/fields/` for field configuration files
- **Documentation**: `doc/` for feature documentation
- **Tests**: `tests/` for all test files (unit, integration, contract)

### Styling Standards

- Use TailwindCSS utility classes matching existing component patterns
- Maintain mobile-responsive design with collapsible UI elements
- Follow existing animation patterns (fade/slide transitions)
- Support both light and dark color schemes where applicable

### Development Commands

- `npm run dev` or `yarn dev` - Start development server
- `npm run build` or `yarn build` - Build for production
- `npm run check` or `yarn check` - Run Svelte type checking
- `npm run lint` or `yarn lint` - Run ESLint and Prettier checks
- `npm run format` or `yarn format` - Format code with Prettier
- `npm test` or `yarn test` - Run unit tests with Vitest

### Memory Management

- For "JavaScript heap out of memory" errors: `export NODE_OPTIONS="--max-old-space-size=4096"`
- The project includes periodic garbage collection hints for long-running sessions

## Code Quality

### Type Safety

- TypeScript MUST be used for all components and logic
- Avoid `any` types - use proper type definitions
- Leverage Svelte 5's type inference capabilities

### Reusability

- Reuse existing components when possible:
  - `SchemaForm.svelte` for dynamic forms
  - `MyHolons.svelte` for holon selection
  - `HolonicMap.svelte` for geographic visualization
  - `GoogleTranslate.svelte` for translation needs
- Break complex components into smaller, composable units
- Extract shared logic into utility functions in `src/lib/`

### Testing Requirements

- Unit tests for isolated component logic
- Integration tests for holosphere data synchronization
- Contract tests for schema validation
- Tests MUST be written BEFORE implementation when following TDD

## Governance

### Amendment Process

1. Constitution amendments MUST be proposed with clear rationale
2. Version number MUST be incremented according to semantic versioning:
   - **MAJOR**: Backward incompatible governance/principle removals or redefinitions
   - **MINOR**: New principle/section added or materially expanded guidance
   - **PATCH**: Clarifications, wording, typo fixes, non-semantic refinements
3. All dependent templates and documentation MUST be updated to maintain consistency
4. A Sync Impact Report MUST be generated documenting all changes

### Compliance Review

- All specifications MUST verify compliance with Component Architecture (Principle I)
- All implementations MUST verify proper holosphere usage (Principle II)
- All PRs MUST include appropriate documentation and tests (Principle IV)
- Code reviews MUST verify adherence to existing patterns and styles

### Complexity Justification

- Violations of constitution principles MUST be explicitly justified
- Simpler alternatives MUST be documented and reasons for rejection provided
- Complexity tracking table MUST be maintained in implementation plans

**Version**: 1.0.0 | **Ratified**: 2025-10-26 | **Last Amended**: 2025-10-26
