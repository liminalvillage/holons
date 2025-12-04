# Federation Configuration Component

A beautiful Svelte component for configuring federation between holons in the Harvest dashboard.

## Features

### 🎨 **Beautiful UI/UX**
- Modern dark theme with Tailwind CSS
- Smooth animations and transitions
- Responsive grid layout
- Interactive cards with hover effects
- Loading states and error handling

### 🔗 **Federation Management**
- **Add Federation**: Create bidirectional federation relationships between holons
- **Remove Federation**: Safely unfederate from other holons
- **Visual Status**: See connection status and bidirectional indicators
- **Federation Overview**: Dashboard showing total federations and active lenses

### ⚙️ **Lens Configuration**
- **Granular Control**: Configure which lenses to federate per holon
- **Data Federation**: Select which lenses share data (Quests, Offers, Tags, etc.)
- **Notifications**: Choose which lenses to receive notifications about
- **Visual Indicators**: Color-coded badges for federated vs notification lenses

### 📊 **Available Lenses**
- 🎯 **Quests** - Task and project management
- 🤝 **Offers** - Service and resource offerings
- 🏷️ **Tags** - Categorization and labeling
- 💰 **Expenses** - Financial tracking
- 📢 **Announcements** - Communications
- 👥 **Users** - Member management
- 🛒 **Shopping** - Shopping lists and procurement
- 🔄 **Recurring** - Recurring tasks and events

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

## Technical Implementation

### Component Structure
```
Federation.svelte
├── Header with stats and add button
├── Status messages (error/success)
├── Federation cards grid
├── Add federation modal
└── Lens configuration modal
```

### Key Functions
- `loadFederationData()` - Fetches current federation info
- `addFederation()` - Creates new federation relationships
- `removeFederation()` - Removes federation relationships
- `updateLensConfig()` - Updates lens-specific settings

### Integration
- Uses HoloSphere federation API
- Integrates with dashboard store (ID)
- Follows project's TypeScript and styling patterns
- Responsive design with Tailwind CSS

## Error Handling

The component includes comprehensive error handling:
- Network errors during federation operations
- Invalid holon IDs
- Missing federation data
- Loading states for all async operations

## Accessibility

- Proper ARIA labels and roles
- Keyboard navigation support
- Screen reader friendly
- High contrast design
- Focus management in modals

## Future Enhancements

- Real-time federation status monitoring
- Federation analytics and metrics
- Bulk lens configuration
- Federation templates and presets
- Advanced filtering and search 