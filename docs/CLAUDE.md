# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Development
- `npm run dev` or `yarn dev` - Start development server
- `npm run build` or `yarn build` - Build for production  
- `npm run preview` or `yarn preview` - Preview production build
- `npm run check` or `yarn check` - Run Svelte type checking
- `npm run check:watch` or `yarn check:watch` - Run type checking in watch mode

### Code Quality
- `npm run lint` or `yarn lint` - Run ESLint and Prettier checks
- `npm run format` or `yarn format` - Format code with Prettier
- `npm test` or `yarn test` - Run unit tests with Vitest

### Memory Management
- If encountering "JavaScript heap out of memory" errors, use: `export NODE_OPTIONS="--max-old-space-size=4096"` before running commands
- The project includes memory optimization for long-running sessions

## Architecture Overview

### Core Framework
- **SvelteKit** application with TypeScript
- **Vite** for build tooling and development server
- **TailwindCSS** for styling
- **Netlify** adapter for deployment

### Holonic Network System
- Built around **HoloSphere** library for holonic network management
- Uses **GunDB** for decentralized data synchronization
- Implements real-time peer-to-peer connectivity
- Environment-based configuration (HolonsDebug for development, Holons for production)

### Project Structure
- `src/routes/` - SvelteKit file-based routing with dynamic `[id]` parameter for holon navigation
- `src/components/` - Reusable Svelte components
- `src/dashboard/` - Dashboard-specific components (Layout, TopBar, Sidebar, Overlay)
- `src/components/schemas/` - JSON schema definitions for various entity types
- `src/components/fields/` - Field configuration files for form generation
- `src/lib/schemas.ts` - Schema registry mapping names to definitions

### Key Components
- **Layout.svelte** - Main dashboard layout with sidebar, topbar, and route transitions
- **MyHolons.svelte** - Holon selection and navigation interface
- **SchemaForm.svelte** - Dynamic form generator based on JSON schemas
- **HolonicMap.svelte** - Mapbox-based visualization of holonic networks
- **GoogleTranslate.svelte** - Translation service integration

### Schema System
The application uses a comprehensive schema system for different entity types:
- Communities, Organizations, Projects, People (various versions)
- Offers/Wants, Quests, and Economic initiatives  
- Geographic and social network mapping schemas
- All schemas are versioned and centrally managed in `src/lib/schemas.ts`

### State Management
- Context-based holosphere instance sharing via `setContext('holosphere', holosphere)`
- Route-based state management through SvelteKit stores
- Auto-switching between routes disabled by default (can be enabled via store)

### Special Routes
- Root route (`/`) - Clean MyHolons interface
- QR routes (`/*/qr`) - Clean views without dashboard chrome  
- Dynamic holon routes (`/[id]/*`) - Main dashboard interface with sidebar navigation

### Development Features
- Memory optimization with periodic garbage collection hints
- Route transitions with fade/slide animations
- Keyboard shortcuts (Ctrl+Shift+Z for overlay dashboard)
- Mobile-responsive design with collapsible sidebar

### External Integrations
- **Mapbox GL** for interactive maps and geocoding
- **D3.js** for data visualization
- **Ethers.js** for blockchain connectivity
- **SIWE** (Sign-In with Ethereum) for authentication
- **HTML5 QR Code** for QR code functionality

## Active Technologies
- TypeScript 5.7+ with Svelte 5.0 (001-holon-dna-editor)
- Holosphere/GunDB (decentralized peer-to-peer synchronization) (001-holon-dna-editor)

## Recent Changes
- 001-holon-dna-editor: Added TypeScript 5.7+ with Svelte 5.0
