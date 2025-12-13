# Harvest UI/UX Overhaul Implementation Plan

## Executive Summary

This plan outlines a major UI/UX refactoring to:
1. **Flip layout paradigm**: Browse holons on the left sidebar, navigation cards on top
2. **Centralized theming**: Create a unified CSS design system
3. **Unified title bars**: Consistent, thin headers with holon names
4. **Responsive statistics**: Smaller stats especially on mobile
5. **Holosphere optimization**: Fast, real-time updates across all components
6. **Speed & consistency**: Optimized performance and unified UX

---

## Phase 1: Design System Foundation

### 1.1 Create Central Theme CSS (`src/styles/theme.css`)

```css
/* CSS Custom Properties for theming */
:root {
  /* Colors */
  --color-bg-primary: #111827;      /* gray-900 */
  --color-bg-secondary: #1f2937;    /* gray-800 */
  --color-bg-tertiary: #374151;     /* gray-700 */
  --color-accent: #4f46e5;          /* indigo-600 */
  --color-accent-hover: #4338ca;    /* indigo-700 */
  --color-text-primary: #ffffff;
  --color-text-secondary: #d1d5db;  /* gray-300 */
  --color-text-muted: #6b7280;      /* gray-500 */
  --color-border: #374151;          /* gray-700 */

  /* Spacing */
  --spacing-xs: 0.25rem;
  --spacing-sm: 0.5rem;
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  --spacing-xl: 2rem;

  /* Title Bar */
  --titlebar-height: 36px;
  --titlebar-font-size: 0.875rem;

  /* Navigation */
  --topbar-height: 48px;
  --sidebar-width-expanded: 280px;
  --sidebar-width-collapsed: 64px;

  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-normal: 300ms ease;
  --transition-slow: 500ms ease;

  /* Border Radius */
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.5);
}

/* Responsive overrides */
@media (max-width: 768px) {
  :root {
    --titlebar-height: 32px;
    --titlebar-font-size: 0.75rem;
    --topbar-height: 44px;
  }
}
```

### 1.2 Component Base Classes

Create reusable CSS classes for:
- `.title-bar` - Unified component headers
- `.stat-card` / `.stat-card-compact` - Statistics display
- `.nav-card` - Top navigation holon cards
- `.browse-item` - Sidebar browse items
- `.panel` - Content panels

### 1.3 Files to Create

| File | Purpose |
|------|---------|
| `src/styles/theme.css` | CSS custom properties and base styles |
| `src/styles/components.css` | Reusable component classes |
| `src/styles/utilities.css` | Utility classes for common patterns |
| `src/styles/index.css` | Main entry point importing all styles |

---

## Phase 2: Layout Flip - Structural Changes

### 2.1 New Layout Architecture

**Current Structure:**
```
┌─────────────────────────────────────────────┐
│  TopBar (holon tabs + controls)             │
├────────┬────────────────────────────────────┤
│Sidebar │                                    │
│(nav)   │  Main Content                      │
│        │                                    │
└────────┴────────────────────────────────────┘
```

**New Structure:**
```
┌─────────────────────────────────────────────┐
│  TopBar (nav cards + controls)              │
├────────┬────────────────────────────────────┤
│Browser │                                    │
│(holons)│  Main Content                      │
│        │                                    │
└────────┴────────────────────────────────────┘
```

### 2.2 Component Transformations

| Current Component | New Role | Changes |
|-------------------|----------|---------|
| `TopBar.svelte` | Navigation Cards Bar | Move holon tabs to nav cards style, keep controls |
| `Sidebar.svelte` | Holon Browser Panel | Display holon list with search, filter, hierarchy |
| `SidebarItems.svelte` | TopNavItems.svelte | Convert to horizontal nav cards |
| `MyHolons.svelte` | Integrated into Browser | Embedded in left sidebar |

### 2.3 New Component Structure

```
src/dashboard/
├── Layout.svelte              (updated)
├── TopBar.svelte              (nav cards + controls)
├── TopNavItems.svelte         (new - horizontal nav cards)
├── browser/
│   ├── BrowserPanel.svelte    (new - main browser container)
│   ├── BrowserHeader.svelte   (new - search/filter header)
│   ├── HolonList.svelte       (new - holon list view)
│   └── HolonItem.svelte       (new - single holon item)
└── sidebar/                   (deprecated, migrate to browser/)
```

---

## Phase 3: Unified Title Bars

### 3.1 TitleBar Component Specification

Create `src/components/shared/TitleBar.svelte`:

```svelte
<script lang="ts">
  export let title: string = '';
  export let holonName: string = '';
  export let showBack: boolean = false;
  export let compact: boolean = false;
</script>

<header class="title-bar" class:compact>
  {#if showBack}
    <button class="back-btn">←</button>
  {/if}
  <div class="title-content">
    <span class="holon-name">{holonName}</span>
    {#if title}
      <span class="separator">›</span>
      <span class="page-title">{title}</span>
    {/if}
  </div>
  <slot name="actions" />
</header>
```

### 3.2 Title Bar Styling

- Height: 36px (32px mobile)
- Font size: 14px (12px mobile)
- Background: `var(--color-bg-secondary)`
- Border-bottom: 1px solid `var(--color-border)`
- Padding: `var(--spacing-sm) var(--spacing-md)`

### 3.3 Components to Update

All major components need TitleBar integration:
- Dashboard.svelte
- Tasks.svelte
- Calendar.svelte (Schedule)
- Roles.svelte
- HolonicMap.svelte
- Tags.svelte
- Proposals.svelte
- OffersRequests.svelte
- ShoppingList.svelte
- Checklist.svelte
- Status.svelte
- Federation.svelte
- Flow.svelte
- Settings.svelte
- Database.svelte

---

## Phase 4: Responsive Statistics

### 4.1 StatCard Component

Create `src/components/shared/StatCard.svelte`:

```svelte
<script lang="ts">
  export let label: string;
  export let value: number | string;
  export let icon: any = null;
  export let trend: 'up' | 'down' | 'neutral' = 'neutral';
  export let compact: boolean = false;
</script>

<div class="stat-card" class:compact>
  {#if icon}
    <div class="stat-icon"><svelte:component this={icon} /></div>
  {/if}
  <div class="stat-content">
    <span class="stat-value">{value}</span>
    <span class="stat-label">{label}</span>
  </div>
</div>
```

### 4.2 Responsive Behavior

**Desktop (>1024px):**
- Full stat cards with icons
- Grid: 4 columns

**Tablet (768px-1024px):**
- Compact stat cards
- Grid: 3 columns

**Mobile (<768px):**
- Inline stat display (value + label)
- Grid: 2 columns or horizontal scroll
- Option to collapse/expand stats section

### 4.3 Statistics Dashboard Update

Refactor `Dashboard.svelte` to use:
- `StatCard` components
- Responsive grid
- Collapsible stats section on mobile
- Real-time holosphere subscriptions

---

## Phase 5: Holosphere Query Optimization

### 5.1 Create Query Manager

`src/lib/holosphere/QueryManager.ts`:

```typescript
interface QueryConfig {
  holonId: string;
  lens: string;
  onUpdate: (data: any[]) => void;
  filters?: Record<string, any>;
}

class QueryManager {
  private subscriptions: Map<string, Subscription>;
  private cache: Map<string, any[]>;

  subscribe(config: QueryConfig): () => void;
  unsubscribe(key: string): void;
  invalidate(holonId: string, lens?: string): void;
  getCache(key: string): any[] | undefined;
}
```

### 5.2 Reactive Query Hook

`src/lib/holosphere/useHolosphereQuery.ts`:

```typescript
export function useHolosphereQuery(
  holonId: string,
  lens: string,
  options?: QueryOptions
) {
  // Returns reactive store with:
  // - data: any[]
  // - loading: boolean
  // - error: Error | null
  // - refetch: () => Promise<void>
}
```

### 5.3 Components to Optimize

Priority order for optimization:
1. Dashboard.svelte (main stats)
2. Tasks.svelte (quest data)
3. MyHolons.svelte → BrowserPanel (holon list)
4. OffersRequests.svelte
5. ShoppingList.svelte
6. Checklist.svelte
7. Roles.svelte
8. Status.svelte

### 5.4 Caching Strategy

- In-memory cache with TTL
- LocalStorage persistence for offline
- Optimistic updates for writes
- Debounced subscription updates

---

## Phase 6: Performance Optimization

### 6.1 Code Splitting

- Lazy load heavy components (Map, Calendar, Council)
- Dynamic imports for route components
- Preload critical paths

### 6.2 Rendering Optimization

- Virtual scrolling for long lists
- Memoization of expensive computations
- Debounced search/filter inputs
- RequestAnimationFrame for animations

### 6.3 Asset Optimization

- Tree-shake unused icon imports
- Lazy load images
- Preconnect to holosphere relay

### 6.4 Monitoring

- Add performance marks for key operations
- Track component render times
- Monitor holosphere query latency

---

## Implementation Order

### Week 1: Foundation
1. [ ] Create design system CSS files
2. [ ] Import theme in root layout
3. [ ] Create TitleBar component
4. [ ] Create StatCard component

### Week 2: Layout Flip
5. [ ] Create BrowserPanel component structure
6. [ ] Migrate holon list to browser
7. [ ] Create TopNavItems component
8. [ ] Update Layout.svelte structure
9. [ ] Update TopBar.svelte

### Week 3: Component Updates
10. [ ] Update Dashboard.svelte with TitleBar + StatCards
11. [ ] Update Tasks.svelte
12. [ ] Update remaining major components (10+)

### Week 4: Holosphere Optimization
13. [ ] Create QueryManager
14. [ ] Create useHolosphereQuery hook
15. [ ] Refactor components to use new query system
16. [ ] Add caching layer

### Week 5: Polish & Performance
17. [ ] Implement virtual scrolling
18. [ ] Add code splitting
19. [ ] Performance testing
20. [ ] Bug fixes and refinements

---

## File Changes Summary

### New Files (15)
- `src/styles/theme.css`
- `src/styles/components.css`
- `src/styles/utilities.css`
- `src/styles/index.css`
- `src/components/shared/TitleBar.svelte`
- `src/components/shared/StatCard.svelte`
- `src/components/shared/StatGrid.svelte`
- `src/dashboard/TopNavItems.svelte`
- `src/dashboard/browser/BrowserPanel.svelte`
- `src/dashboard/browser/BrowserHeader.svelte`
- `src/dashboard/browser/HolonList.svelte`
- `src/dashboard/browser/HolonItem.svelte`
- `src/lib/holosphere/QueryManager.ts`
- `src/lib/holosphere/useHolosphereQuery.ts`
- `src/lib/holosphere/cache.ts`

### Modified Files (20+)
- `src/app.html` (add theme CSS import)
- `src/routes/+layout.svelte`
- `src/dashboard/Layout.svelte`
- `src/dashboard/TopBar.svelte`
- `src/components/Dashboard.svelte`
- `src/components/Tasks.svelte`
- `src/components/MyHolons.svelte`
- Plus 15+ other component files

### Deprecated/Removed
- `src/dashboard/sidebar/` (content migrated to browser/)

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking existing functionality | Incremental changes, feature flags |
| Performance regression | Benchmark before/after each phase |
| Layout breaking on mobile | Test each breakpoint thoroughly |
| Holosphere sync issues | Maintain fallback to direct queries |

---

## Success Metrics

- [ ] All components use unified TitleBar
- [ ] Statistics collapse properly on mobile
- [ ] Holon browser works in sidebar
- [ ] Navigation cards work in topbar
- [ ] All data updates in real-time
- [ ] Page load time < 2 seconds
- [ ] No layout shift on navigation

---

## Questions for Clarification

1. **Color scheme**: Keep current dark gray + indigo, or new colors?
2. **Sidebar width**: What's the preferred expanded width for the browser?
3. **Stats priority**: Which stats are most important to show on mobile?
4. **Navigation cards**: How many nav items should be visible by default?
5. **Animation preferences**: Fast snappy or smooth easing?

---

*Plan created: 2025-12-12*
*Estimated scope: Major refactoring (~5 phases)*
