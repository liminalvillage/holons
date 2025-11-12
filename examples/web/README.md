# HoloSphere Permaculture Flower Ecosystem Examples

A collection of 14 interconnected web-based examples demonstrating how HoloSphere enables decentralized, location-based collaboration across the full spectrum of community needs, organized according to the Permaculture Flower framework.

## Overview

This ecosystem showcases how HoloSphere's holonic geospatial architecture can power a complete regenerative community system, with each project operating independently while seamlessly integrating with others through federation.

## The 14 Projects

### 🌱 Land & Nature Stewardship
1. **[TerraTrust](terratrust.html)** - Community land monitoring & biodiversity tracking
2. **[WaterWise](waterwise.html)** - Watershed management & water quality monitoring

### 🏘️ Built Environment
3. **[NeighborHub](neighborhub.html)** - Community space sharing & resource pooling
4. **[EcoConstruct](ecoconstruct.html)** - Sustainable building materials marketplace

### 🔧 Tools & Technology
5. **[ToolLibrary](toollibrary.html)** - Community tool sharing network
6. **[SkillSwap](skillswap.html)** - Local expertise & knowledge exchange

### 📚 Culture & Education
7. **[StoryCircle](storycircle.html)** - Oral history & cultural heritage preservation
8. **[LearnLocal](learnlocal.html)** - Peer-to-peer learning platform

### 💚 Health & Spiritual Well-being
9. **[HealingSpaces](healingspaces.html)** - Community wellness resource mapping
10. **[MindfulMeets](mindfulmeets.html)** - Meditation & gathering coordination

### 💰 Finances & Economics
11. **[LocalLoop](localloop.html)** - Local currency & community exchange
12. **[CoopCreds](coopcreds.html)** - Cooperative credit & mutual aid

### 🏛️ Land Tenure & Community Governance
13. **[VoiceVillage](voicevillage.html)** - Participatory decision-making
14. **[CommonGround](commonground.html)** - Community land trust management

## Getting Started

### Quick Start

1. Open `index.html` in your web browser to see the ecosystem overview
2. Click on any project to explore its interactive demo
3. Each project includes:
   - Working demos with sample data
   - Interactive forms to create new data
   - Real-time statistics
   - Code examples showing HoloSphere API usage
   - Ecosystem connection visualizations

### No Server Required

These examples run entirely in the browser using:
- **localStorage** for data persistence
- **HoloSphere Demo API** (`holosphere-web.js`) - a browser-compatible simulation
- Pure HTML/CSS/JavaScript - no build step needed

Simply open any `.html` file in a modern web browser!

## How HoloSphere Powers This Ecosystem

### Geographic Organization
Each project uses **H3 hexagonal indexing** to organize data spatially:
- TerraTrust monitors specific watersheds and meadows
- NeighborHub organizes spaces by neighborhood
- WaterWise tracks streams and water bodies
- All projects can discover nearby data using geographic proximity

### Federation
Projects federate their holons to share relevant data:
- TerraTrust → WaterWise: Land health feeds water quality analysis
- ToolLibrary → EcoConstruct: Tools enable sustainable building
- LocalLoop → ALL: Community currency enables economic exchange
- VoiceVillage → ALL: Democratic governance across the ecosystem

### Decentralization
Built on GunDB principles:
- No central server required
- Community-owned data
- Peer-to-peer synchronization
- Resilient to network partitions

### Real-time Subscriptions
Projects can subscribe to data changes:
- WaterWise alerts on water quality issues
- NeighborHub notifies about space availability
- VoiceVillage tracks live voting
- MindfulMeets updates gathering attendance

## Example Integrations

Here are some of the 28+ integration points between projects:

1. **TerraTrust** ⟷ **WaterWise**: Land observations inform watershed health
2. **NeighborHub** ⟷ **LearnLocal**: Spaces host educational workshops
3. **ToolLibrary** ⟷ **EcoConstruct**: Shared tools enable eco-building
4. **SkillSwap** ⟷ **LearnLocal**: Experts teach structured classes
5. **LocalLoop** ⟷ **ToolLibrary**: Community currency for tool deposits
6. **CoopCreds** ⟷ **CommonGround**: Cooperative financing for land acquisition
7. **VoiceVillage** ⟷ **ALL**: Democratic decision-making across ecosystem
8. **HealingSpaces** ⟷ **CommonGround**: Wellness locations on trust land

## Technical Architecture

### File Structure
```
examples/web/
├── index.html              # Ecosystem overview
├── README.md              # This file
├── assets/
│   ├── css/
│   │   └── shared.css     # Design system
│   └── js/
│       └── holosphere-web.js  # Browser HoloSphere API
├── terratrust.html
├── waterwise.html
├── neighborhub.html
├── ecoconstruct.html
├── toollibrary.html
├── skillswap.html
├── storycircle.html
├── learnlocal.html
├── healingspaces.html
├── mindfulmeets.html
├── localloop.html
├── coopcreds.html
├── voicevillage.html
└── commonground.html
```

### HoloSphere API Usage

Each project demonstrates core HoloSphere operations:

```javascript
// Initialize
const sphere = new HoloSphere('ProjectName');

// Store data in a holon
await sphere.put('holon-id', 'lens-name', {
  id: 'item-id',
  data: 'value'
});

// Retrieve all data from a holon/lens
const items = await sphere.getAll('holon-id', 'lens-name');

// Subscribe to real-time updates
sphere.subscribe('holon-id', 'lens-name', (data) => {
  console.log('New data:', data);
});

// Federate holons
await sphere.federate('holon-a', 'holon-b');

// Get federated data
const federated = await sphere.getFederated('holon-a', 'lens-name');
```

## Production Deployment

While these examples use a simulated browser API, production deployments would:

1. **Use the full HoloSphere library** (`holosphere.js`) with GunDB
2. **Set up GunDB relay servers** for peer-to-peer synchronization
3. **Configure H3 resolution** appropriate for your geographic scale
4. **Implement authentication** using GunDB's SEA (Security, Encryption, Authorization)
5. **Add real-time subscriptions** for live data updates
6. **Bundle for browsers** using Webpack/Vite if needed

## Design System

All pages share a consistent design system (`shared.css`):
- **Colors**: Themed by permaculture petal
- **Typography**: System font stack
- **Components**: Cards, buttons, badges, forms, stats
- **Layout**: Responsive grid system
- **Animations**: Smooth transitions

## Browser Compatibility

These examples work in all modern browsers:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

Requires JavaScript and localStorage enabled.

## License

These examples are part of the HoloSphere project, licensed under LGPL-3.0.

## Learn More

- **HoloSphere Documentation**: [../../README.md](../../README.md)
- **Federation System**: [../../FEDERATION.md](../../FEDERATION.md)
- **Main Examples**: [../](../)
- **Tests**: [../../test/](../../test/)

## Contributing

To add a new example:

1. Follow the structure of existing project pages
2. Use the shared design system (`assets/css/shared.css`)
3. Integrate with `holosphere-web.js` for demos
4. Show ecosystem connections
5. Include code examples
6. Update `index.html` to link to your project

---

**Built with HoloSphere** - Holonic Geospatial Communication Infrastructure
