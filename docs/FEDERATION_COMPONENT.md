# Federation Configuration Component

A Svelte component for configuring federation between holons in the Holons
web dashboard (`apps/web`). It is the UI on top of the core federation layer
documented in [architecture.md](./architecture.md).

## Features

### UI/UX
- Dark theme with Tailwind CSS
- Animations and transitions
- Responsive grid layout
- Interactive cards with hover effects
- Loading states and error handling

### Federation management
- **Add Federation**: Create bidirectional federation relationships between holons
- **Remove Federation**: Safely unfederate from other holons
- **Visual Status**: See connection status and bidirectional indicators
- **Federation Overview**: Dashboard showing total federations and active lenses

### Lens configuration
- **Granular control**: Configure which lenses to federate per holon
- **Data federation**: Select which lenses share data (Quests, Offers, Tags, etc.)
- **Notifications**: Choose which lenses to receive notifications about
- **Visual indicators**: Color-coded badges for federated vs notification lenses

### Available lenses
- **Quests** - Task and project management
- **Offers** - Service and resource offerings
- **Tags** - Categorization and labeling
- **Expenses** - Financial tracking
- **Announcements** - Communications
- **Users** - Member management
- **Shopping** - Shopping lists and procurement
- **Recurring** - Recurring tasks and events

## Usage

### Navigation
Access the Federation configuration through the Dashboard:
1. Go to your holon dashboard (`/{holonId}/dashboard`)
2. Click the **Federation** card in the secondary stats grid
3. Or navigate directly to `/{holonId}/federation`

### Adding a Federation
1. Click the **"Add Federation"** button
2. Enter the target holon ID
3. Optionally provide a display name
4. Click **"Create Federation"** to establish the relationship

### Configuring Lenses
1. Click the **gear icon** on any federation card
2. Select which lenses to **federate** (share data from this holon)
3. Select which lenses to **notify** (receive notifications about)
4. Click **"Save Changes"** to apply the configuration

### Visual Indicators
- **Green dot**: Connected federation
- **Blue badges**: Federated lenses (data sharing)
- **Green badges**: Notification lenses (receiving updates)
- **Bidirectional tag**: Two-way federation relationship

## Technical implementation

The component lives under `apps/web/src/` and renders federation state for
the holon currently in the dashboard `ID` store.

### Component structure
```
Federation component
├── Header with stats and add button
├── Status messages (error/success)
├── Federation cards grid
├── Add federation modal
└── Lens configuration modal
```

### Key functions
- `loadFederationData()` - Fetches current federation info
- `addFederation()` - Creates new federation relationships
- `removeFederation()` - Removes federation relationships
- `updateLensConfig()` - Updates lens-specific settings

### Integration
- Goes through `@holons/core/federation` and the shared HoloSphere instance
  (see [architecture.md](./architecture.md) and
  [realtime-sync.md](./realtime-sync.md))
- Integrates with the dashboard store (`ID`)
- Follows the project's TypeScript and Tailwind styling patterns

## Error handling

The component handles:
- Network errors during federation operations
- Invalid holon IDs
- Missing federation data
- Loading states for all async operations

## Accessibility

- ARIA labels and roles
- Keyboard navigation support
- Screen reader friendly
- High contrast design
- Focus management in modals
