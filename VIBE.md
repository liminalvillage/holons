# Claude Code Instructions for Holosphere Repository

## Project Overview

You are working on **Holosphere** - a distributed coordination infrastructure enabling agent-centric collaboration without centralized platforms. The project uses Gun distributed database with geospatial indexing (H3) for local-first, federated data management.

**Current Version:** 1.1.10  
**License:** GPL-3.0-or-later  
**Lead Developer:** Roberto Valenti

---

## HOLOSPHERE CONSTITUTION

### 1. CODE QUALITY STANDARDS

- **ES6+ modules:** Use import/export, async/await
- **Type definitions:** Keep holosphere.d.ts synchronized with implementation
- **JSDoc required:** Document all public methods with types and parameters
- **Naming conventions:**
  - camelCase for functions/variables
  - PascalCase for classes
- **Error handling:** Validate inputs, throw descriptive errors
- **Modularity:** 
  - `holosphere.js` (core)
  - `federation.js` (federation)
  - `hexlib.js` (utilities)

### 2. TESTING REQUIREMENTS

- **Framework:** Jest with ES modules (npm test)
- **Coverage:** All major functionality must have tests
- **Test files:**
  - `test/holosphere.test.js`
  - `test/federation.test.js`
  - `test/subscription.test.js`
  - `test/reference.test.js`
  - `test/auth.test.js`
  - `test/delete.test.js`
- **Gate:** All tests must pass before merging

### 3. USER EXPERIENCE PRIORITIES

- **Sensible defaults:** Works with minimal configuration
- **Progressive complexity:** Simple cases stay simple, complex cases possible
- **Clear API:** Method names indicate purpose
- **Good examples:** README includes real-world use cases
- **Helpful errors:** Messages explain what failed and why

### 4. PERFORMANCE REQUIREMENTS

- **Lazy loading:** Initialize only what's needed
- **Caching:** Reuse schemas, avoid redundant queries
- **Soul references:** Use references instead of duplicating data in federation
- **Cleanup:** Provide unsubscribe methods and close()
- **Bounded operations:** maxLevels, timeout parameters where needed

### 5. TECHNICAL GOVERNANCE

- **Version control:** Semantic versioning (currently 1.1.10)
- **Dependencies:**
  - h3-js (geospatial indexing)
  - gun (distributed storage)
  - ajv (schema validation)
  - openai (optional AI features)
- **Security:** Validate inputs, use Gun SEA for auth, run npm audit
- **License:** GPL-3.0-or-later
- **Code review:** All PRs reviewed before merge
- **Release checklist:** Tests pass, docs updated, version bumped

---

## SPEC-DRIVEN DEVELOPMENT WORKFLOW

When working on new features, follow this structured process:

### Phase 1: SPECIFICATION (`/speckit.specify`)
Define **WHAT** to build, not HOW:
- Focus on requirements, user stories, and functionality
- Be explicit about user flows and business logic
- Do NOT mention tech stack or implementation details yet
- Reference the Constitution above for quality expectations

### Phase 2: CLARIFICATION (`/speckit.clarify`)
Before planning implementation:
- Ask targeted questions about underspecified requirements
- Identify edge cases and ambiguities
- Clarify user flows and business logic
- Ensure specification completeness

### Phase 3: TECHNICAL PLAN (`/speckit.plan`)
Create implementation plan adhering to Constitution:
- **Tech stack:** JavaScript ES6+, Gun, H3-js, Ajv
- Architecture decisions following modularity standards
- Data models with type definitions
- Component breakdown respecting existing structure
- **Validate against Constitution:** Ensure plan meets all 5 sections

### Phase 4: TASK BREAKDOWN (`/speckit.tasks`)
Generate ordered, executable tasks:
- Group by user story
- Mark dependencies and parallel-executable tasks
- Include file paths (following existing structure)
- Test-first approach (Jest tests before implementation)
- Checkpoint validations after each user story

### Phase 5: IMPLEMENTATION (`/speckit.implement`)
Execute tasks systematically:
- Follow Constitution standards (JSDoc, error handling, naming)
- Write tests first, then implementation
- Update `holosphere.d.ts` for any new APIs
- Run `npm test` at checkpoints
- Ensure all tests pass before completion

---

## KEY REPOSITORY STRUCTURE

```
holosphere/
├── holosphere.js           # Core API
├── federation.js           # Federation logic
├── hexlib.js              # H3 utilities
├── holosphere.d.ts        # Type definitions
├── test/                  # Jest test suite
├── examples/              # Usage examples
├── .specify/              # Spec-Driven Development artifacts
│   ├── specs/            # Feature specifications
│   └── templates/        # SDD templates
└── .claude/              # This file
    └── instructions.md
```

---

## HOLONS PHILOSOPHY CONTEXT

This project embodies **agent-centric coordination** principles:
- **Local-first:** Data sovereignty for each agent
- **Federated:** Peer-to-peer collaboration without central authority
- **Membrane-based:** Boundaries define groups through permeability
- **Holon-parton:** Each entity is simultaneously whole and part
- **Distributed trust:** Cryptographic identity, not platform control

When designing features, consider:
- How does this preserve agent autonomy?
- Does it enable federation without surrendering control?
- Is it local-first compatible?
- Does it respect membrane boundaries?

---

## BEFORE STARTING ANY FEATURE

1. ✅ Read this Constitution thoroughly
2. ✅ Understand the existing codebase structure
3. ✅ Review related test files for patterns
4. ✅ Check `holosphere.d.ts` for type context
5. ✅ Reference examples/ for usage patterns

## VALIDATION CHECKLIST FOR EVERY FEATURE

- [ ] Follows all Code Quality Standards
- [ ] Has comprehensive Jest tests
- [ ] Maintains User Experience Priorities
- [ ] Meets Performance Requirements
- [ ] Adheres to Technical Governance
- [ ] Updates `holosphere.d.ts` if APIs changed
- [ ] Includes JSDoc for all public methods
- [ ] All tests pass (`npm test`)
- [ ] README examples updated if needed
- [ ] Aligns with agent-centric philosophy

---

**Constitution Version:** 1.0  
**Constitution Author:** Roberto Valenti  
**Last Updated:** November 2025
