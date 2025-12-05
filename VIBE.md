# Claude Code Instructions for Harvest Repository

## Project Overview

You are working on **Harvest** - a dashboard for visualizing and interacting with holonic networks. Built on SvelteKit, it provides an intuitive interface for monitoring and managing holonic systems using the Holosphere distributed coordination infrastructure.

**Current Version:** 1.0.0
**License:** MIT
**Lead Developer:** Roberto Valenti

---

## HARVEST CONSTITUTION

### 1. CODE QUALITY STANDARDS

- **TypeScript + Svelte 5:** Use modern TypeScript with Svelte 5 components
- **Naming conventions:**
  - camelCase for functions/variables/props
  - PascalCase for components and classes
  - kebab-case for file names (following SvelteKit conventions)
- **Type safety:**
  - Maintain tsconfig.json strict mode settings
  - Use type definitions for all component props
  - Keep types in `src/types/` directory when shared
- **Component standards:**
  - Keep components focused and single-purpose
  - Use Svelte context for dependency injection (`setContext`/`getContext`)
  - Avoid prop drilling - use stores or context for deep hierarchies
  - Component files should export their main component as default
- **Error handling:**
  - Validate user inputs in forms
  - Gracefully handle network failures (Gun/Holosphere may disconnect)
  - Provide user-friendly error messages
  - Log errors to console with context
- **Modularity:**
  - `src/components/` - Reusable UI components
  - `src/dashboard/` - Dashboard-specific layout and navigation
  - `src/routes/` - SvelteKit file-based routing
  - `src/lib/` - Shared utilities and schema registry
  - `src/stores/` - Svelte stores for state management
  - `src/services/` - Business logic and external integrations

### 2. TESTING REQUIREMENTS

- **Framework:** Vitest with SvelteKit integration
- **Commands:**
  - `npm run test:unit` or `yarn test:unit` - Run unit tests
  - `npm run check` or `yarn check` - Type checking
  - `npm run check:watch` or `yarn check:watch` - Type checking in watch mode
- **Coverage expectations:**
  - All utility functions must have tests
  - Complex business logic in services must have tests
  - Schema validation logic must be tested
  - UI components should have basic smoke tests where practical
- **Test location:** `src/**/*.test.ts` or `src/**/*.spec.ts`
- **Gate:** All tests and type checks must pass before merging

### 3. USER EXPERIENCE PRIORITIES

- **Progressive enhancement:**
  - Core functionality works without JavaScript where possible
  - Graceful degradation for missing features
- **Responsive design:**
  - Mobile-first approach with TailwindCSS
  - Collapsible sidebar for mobile devices
  - Touch-friendly controls
- **Performance:**
  - Lazy load heavy components (maps, visualizations)
  - Use Svelte transitions judiciously to avoid janky animations
  - Memory optimization for long-running sessions (GC hints every minute)
- **Accessibility:**
  - Semantic HTML elements
  - ARIA labels where needed
  - Keyboard navigation support (e.g., Ctrl+Shift+Z for overlay dashboard)
- **Clear navigation:**
  - Intuitive sidebar with icon-based navigation
  - Consistent route structure (`/[id]/route-name`)
  - Visual feedback for active routes

### 4. PERFORMANCE REQUIREMENTS

- **Memory management:**
  - Use `export NODE_OPTIONS="--max-old-space-size=4096"` for large datasets
  - Periodic GC hints implemented in root layout
  - Clean up subscriptions and timers in `onDestroy`
- **Bundle optimization:**
  - Keep vendor bundles separate
  - Use dynamic imports for heavy libraries (Mapbox, D3)
  - Vite handles code splitting automatically - don't override without reason
- **Data handling:**
  - Use Holosphere's soul references to avoid data duplication
  - Cache schema lookups to avoid redundant parsing
  - Debounce user inputs for real-time search/filter
- **Network optimization:**
  - Gun handles peer-to-peer sync - trust it
  - Environment-based Gun configuration (HolonsDebug for dev, Holons for prod)
  - Give holosphere 500ms to initialize before rendering data-dependent UI

### 5. TECHNICAL GOVERNANCE

- **Version control:**
  - Semantic versioning (currently 1.0.0)
  - Meaningful commit messages following conventional commits
  - Feature branches with descriptive names
- **Dependencies:**
  - **Core:** svelte@5, @sveltejs/kit@2, vite@6, typescript@5
  - **Holonic:** holosphere@1.1.20 (Gun-based distributed storage)
  - **UI:** tailwindcss@3, svelte-feather-icons@4
  - **Maps:** mapbox-gl@3, @mapbox/mapbox-gl-geocoder@5
  - **Data viz:** d3@7
  - **Blockchain:** ethers@6, siwe@3
  - **Other:** html5-qrcode@2, sass@1
- **Code review:**
  - All PRs require review before merge
  - Run `npm run lint` and `npm run check` before submitting PR
  - Manual testing required for UI changes
- **Schema management:**
  - All schemas versioned with semver (e.g., `person_schema-v0.2.0.json`)
  - Schema registry in `src/lib/schemas.ts` must be updated
  - Breaking schema changes require new version, not modification
- **Environment variables:**
  - Never commit `.env` files
  - Update `.env.example` when adding new variables
  - Use `import.meta.env.VITE_*` for client-side variables
- **Security:**
  - Content Security Policy configured in `netlify.toml`
  - Validate all user inputs before saving to Gun
  - Use Gun SEA for authentication when needed
  - Never expose API keys in client code
- **Deployment:**
  - Netlify adapter configured for production
  - Node.js 20+ required
  - Build command: `npm run build`
  - Preview builds automatically created for PRs

---

## SCHEMA-DRIVEN DEVELOPMENT WORKFLOW

Harvest uses a **schema-driven architecture** for entity management. All entity types (people, organizations, projects, offers/wants, etc.) are defined by JSON schemas.

### Schema System Architecture

**Schema Registry:** `src/lib/schemas.ts`
- Central registry mapping schema names to definitions
- Typed schema names for compile-time safety
- Import all schemas and export as object

**Schema Files:** `src/components/schemas/*.json`
- JSON Schema format (draft-07 compatible)
- Versioned filenames: `{entity}_schema-v{major}.{minor}.{patch}.json`
- Define properties, required fields, types, and validation rules

**Schema Forms:** `src/components/SchemaForm.svelte`
- Dynamic form generator based on JSON schemas
- Automatic validation using schema rules
- Saves data to Holosphere with proper soul references

### Adding a New Schema

1. **Create JSON Schema:**
   - Add file to `src/components/schemas/`
   - Follow naming convention: `{entity}_schema-v{version}.json`
   - Use JSON Schema draft-07 format
   - Include title, description, properties, required fields

2. **Register Schema:**
   - Import in `src/lib/schemas.ts`
   - Add to `schemas` export object with proper key
   - Update `SchemaName` type

3. **Create Route (if needed):**
   - Add route in `src/routes/[id]/{entity}/`
   - Use `SchemaForm.svelte` component
   - Pass schema name and holosphere context

4. **Add Navigation (if needed):**
   - Add icon to `src/dashboard/sidebar/icons/`
   - Register in `src/dashboard/sidebar/data.ts`
   - Icon appears in sidebar automatically

### Schema Best Practices

- **Versioning:** Never modify existing schemas - create new versions
- **Validation:** Use JSON Schema features (pattern, minLength, enum, etc.)
- **Extensibility:** Allow additional properties where appropriate
- **Documentation:** Include descriptions for all properties
- **Consistency:** Follow naming conventions across schemas

---

## HOLOSPHERE INTEGRATION PATTERNS

### Context-Based Holosphere Instance

```svelte
<!-- Root layout provides holosphere instance -->
<script lang="ts">
  import { setContext } from 'svelte';
  import HoloSphere from 'holosphere';

  const environmentName =
    import.meta.env.VITE_LOCAL_MODE === "development"
      ? "HolonsDebug"
      : "Holons";

  const holosphere = new HoloSphere(environmentName);
  setContext('holosphere', holosphere);
</script>
```

```svelte
<!-- Child components access holosphere -->
<script lang="ts">
  import { getContext } from 'svelte';

  const holosphere = getContext('holosphere');

  // Use holosphere for data operations
  holosphere.get('entity-soul-id').subscribe((data) => {
    // Handle data updates
  });
</script>
```

### Data Patterns

- **Soul references:** Store references to related entities, not full data copies
- **Subscriptions:** Use Gun's `.on()` for real-time updates
- **Cleanup:** Always unsubscribe in `onDestroy` to prevent memory leaks
- **Initialization:** Wait for holosphere ready state before critical operations

### Federation & Membranes

- Federation components in `src/components/Federation.svelte`
- Membrane-based boundaries for holon groups
- Trust through cryptographic identity, not platform control

---

## KEY REPOSITORY STRUCTURE

```
harvest/
├── src/
│   ├── routes/              # SvelteKit file-based routing
│   │   ├── +layout.svelte  # Root layout (holosphere initialization)
│   │   ├── +page.svelte    # Root page (MyHolons interface)
│   │   └── [id]/           # Dynamic holon routes
│   │       ├── offers/
│   │       ├── roles/
│   │       ├── tasks/
│   │       └── ...
│   ├── components/          # Reusable Svelte components
│   │   ├── schemas/        # JSON schema definitions
│   │   ├── SchemaForm.svelte
│   │   ├── MyHolons.svelte
│   │   ├── HolonicMap.svelte
│   │   └── ...
│   ├── dashboard/           # Dashboard layout components
│   │   ├── Layout.svelte   # Main dashboard layout
│   │   ├── TopBar.svelte
│   │   ├── Sidebar.svelte
│   │   ├── Overlay.svelte
│   │   └── sidebar/
│   │       ├── data.ts     # Navigation data
│   │       └── icons/      # Sidebar icons
│   ├── lib/                 # Shared utilities
│   │   ├── schemas.ts      # Schema registry
│   │   └── ...
│   ├── stores/              # Svelte stores
│   │   └── settings.ts
│   ├── services/            # Business logic
│   │   └── AdvisorService.ts
│   ├── types/               # TypeScript type definitions
│   └── utils/               # Utility functions
├── static/                  # Static assets
├── tests/                   # Test files
├── .env.example            # Environment variable template
├── netlify.toml            # Netlify deployment config
├── package.json
├── svelte.config.js        # SvelteKit configuration
├── vite.config.ts          # Vite configuration
├── tsconfig.json           # TypeScript configuration
├── tailwind.config.cjs     # TailwindCSS configuration
└── CLAUDE.md               # This file
```

---

## ROUTING CONVENTIONS

### SvelteKit File-Based Routing

- **Root route (`/`)**: Clean MyHolons interface (no dashboard chrome)
- **QR routes (`/*/qr`)**: Clean views for QR code scanning
- **Dynamic routes (`/[id]/*`)**: Main dashboard with sidebar navigation
  - `[id]` parameter represents the current holon soul/ID
  - All dashboard routes nested under `[id]`

### Route Files

- `+page.svelte` - Page component
- `+layout.svelte` - Layout component (wraps child routes)
- `+layout.ts` - Layout data loading
- `+error.svelte` - Error boundary

### Navigation

- Use `goto()` from `$app/navigation` for programmatic navigation
- Use `<a href="...">` for link navigation (SvelteKit handles SPA behavior)
- Current route available via `$page.url.pathname` from `$app/stores`

---

## HOLONS PHILOSOPHY CONTEXT

This project embodies **agent-centric coordination** principles inherited from Holosphere:

- **Local-first:** Data sovereignty for each agent/user
- **Federated:** Peer-to-peer collaboration without central authority
- **Membrane-based:** Boundaries define groups through permeability
- **Holon-parton:** Each entity is simultaneously whole and part
- **Distributed trust:** Cryptographic identity via Gun SEA, not platform control

### Design Principles for Features

When designing features, consider:
1. **Agent autonomy:** Does this preserve user control over their data?
2. **Federation-friendly:** Can it work peer-to-peer without central server?
3. **Local-first compatible:** Does it work offline or with intermittent connectivity?
4. **Membrane-aware:** Does it respect group boundaries and permissions?
5. **Visual clarity:** Is the holonic structure visible and understandable?

---

## DEVELOPMENT COMMANDS

### Essential Commands

**Development:**
```bash
npm run dev          # Start Vite dev server (default port 5173)
yarn dev             # Alternative with yarn

# With increased memory for large datasets:
export NODE_OPTIONS="--max-old-space-size=4096"
npm run dev
```

**Building:**
```bash
npm run build        # Build for production (outputs to build/)
npm run preview      # Preview production build locally
yarn build           # Alternative with yarn
yarn preview
```

**Code Quality:**
```bash
npm run check        # Run Svelte type checking
npm run check:watch  # Run type checking in watch mode
npm run lint         # Run ESLint and Prettier checks
npm run format       # Format code with Prettier
yarn check           # Alternative with yarn
yarn lint
yarn format
```

**Testing:**
```bash
npm run test:unit    # Run Vitest unit tests
yarn test:unit       # Alternative with yarn
```

### Memory Management

If encountering "JavaScript heap out of memory" errors:

```bash
# Export environment variable
export NODE_OPTIONS="--max-old-space-size=4096"

# Or use the provided script
chmod +x start-with-memory.sh
./start-with-memory.sh
```

The application includes automatic memory optimization with periodic GC hints every 60 seconds.

---

## EXTERNAL INTEGRATIONS

### Mapbox GL
- **Configuration:** API token in environment variables
- **Usage:** HolonicMap.svelte, Map.svelte
- **Features:** Interactive maps, geocoding, geospatial visualization
- **H3 integration:** Holosphere uses H3 hexagonal indexing for spatial queries

### D3.js
- **Usage:** Data visualizations, network graphs
- **Components:** HolonFlowVisualization.svelte, ProposalChart.svelte
- **Pattern:** Create SVG in component, use D3 for data binding and updates

### Ethers.js & SIWE
- **Purpose:** Blockchain connectivity and Web3 authentication
- **Configuration:** Web3 provider, chain ID, network in .env
- **Default:** Gnosis Chain (chainId: 100)
- **Pattern:** Sign-In with Ethereum for decentralized authentication

### Google Translate
- **Component:** GoogleTranslate.svelte
- **Purpose:** Multi-language support for global coordination
- **Integration:** Widget-based translation service

### QR Codes
- **Library:** html5-qrcode
- **Components:** QRScanner.svelte, QRCode.svelte
- **Usage:** Holon identification, quick navigation, sharing

---

## BEFORE STARTING ANY FEATURE

1. ✅ Read this Constitution thoroughly
2. ✅ Understand the schema-driven architecture
3. ✅ Review existing components for similar patterns
4. ✅ Check `src/lib/schemas.ts` for existing schemas
5. ✅ Understand holosphere context pattern
6. ✅ Review routing conventions for SvelteKit
7. ✅ Check environment variables in `.env.example`

## VALIDATION CHECKLIST FOR EVERY FEATURE

- [ ] Follows all Code Quality Standards
- [ ] TypeScript types defined and strict mode passes
- [ ] Has Vitest tests for business logic
- [ ] Maintains User Experience Priorities (responsive, accessible)
- [ ] Meets Performance Requirements (memory, bundle size)
- [ ] Adheres to Technical Governance (semver, code review)
- [ ] Updates schema registry if new schemas added
- [ ] Environment variables documented in `.env.example`
- [ ] All tests pass (`npm run test:unit`)
- [ ] Type checking passes (`npm run check`)
- [ ] Linting passes (`npm run lint`)
- [ ] Aligns with agent-centric holons philosophy
- [ ] Works offline/local-first where applicable
- [ ] Properly cleans up subscriptions and timers

---

## COMMON PATTERNS & ANTI-PATTERNS

### ✅ DO

- Use `getContext('holosphere')` to access holosphere instance
- Clean up Gun subscriptions in `onDestroy`
- Use schema-driven forms for entity creation/editing
- Store soul references, not full data copies
- Use TailwindCSS utility classes for styling
- Use Svelte stores for cross-component state
- Export types from component files when needed elsewhere
- Use `$:` reactive declarations for derived state
- Leverage SvelteKit's file-based routing
- Trust Gun's eventual consistency model

### ❌ DON'T

- Don't create new holosphere instances - use context
- Don't forget to unsubscribe from Gun subscriptions
- Don't modify existing schemas - create new versions
- Don't duplicate data across Gun nodes
- Don't use inline styles - use TailwindCSS
- Don't prop-drill through many levels - use context or stores
- Don't commit `.env` files
- Don't force Gun to be synchronous (it's async by design)
- Don't block the UI thread with heavy computations
- Don't override Vite's code splitting without good reason

---

## TROUBLESHOOTING

### Common Issues

**Memory Errors:**
- Use `export NODE_OPTIONS="--max-old-space-size=4096"`
- Check for memory leaks (unsubscribed Gun listeners)
- Use Chrome DevTools memory profiler

**Gun/Holosphere Connection Issues:**
- Verify environment (HolonsDebug vs Holons)
- Check network connectivity
- Verify Gun relay peers are accessible
- Wait for initialization (500ms delay in layout)

**Type Errors:**
- Run `npm run check` to see all errors
- Ensure `.svelte-kit/tsconfig.json` is generated
- Check `tsconfig.json` includes correct paths

**Build Failures:**
- Clear `.svelte-kit` directory
- Clear `node_modules` and reinstall
- Check for circular dependencies
- Verify all imports are correct

**Schema Form Issues:**
- Verify schema is registered in `src/lib/schemas.ts`
- Check schema validity (JSON Schema draft-07)
- Ensure holosphere context is available

---

**Constitution Version:** 1.0
**Constitution Author:** Roberto Valenti
**Last Updated:** November 2025

---

## NOTES FOR CLAUDE CODE

When working on this repository:

1. **Understand before acting:** This is a complex distributed system. Read the context, understand the holons philosophy, and think through implications before making changes.

2. **Schema changes are delicate:** Schemas define the data model for distributed, eventually-consistent data. Breaking changes affect all peers. Always version, never modify in place.

3. **Memory matters:** This app can run for extended sessions visualizing large networks. Be conscious of memory usage, subscription cleanup, and resource management.

4. **Local-first is not optional:** Features must work with Gun's distributed, eventually-consistent model. Don't assume central authority or immediate consistency.

5. **Test thoroughly:** Distributed systems are hard to debug. Write tests, use type checking, and manually test in the UI.

6. **Respect the architecture:** The schema-driven, context-based, route-centric architecture exists for good reasons. Work with it, not against it.

7. **Ask when uncertain:** If you're unsure whether a change aligns with the holons philosophy or distributed nature of the system, ask the user for guidance.
