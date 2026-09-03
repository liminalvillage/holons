# Holons

A decentralized holonic platform for organizational governance, resource distribution, and wisdom aggregation.

[![Documentation](https://img.shields.io/badge/docs-GitBook-blue)](https://liminalvillage.gitbook.io/holons)
[![License](https://img.shields.io/badge/license-AGPL-green)](LICENSE)

> **Full Documentation**: [https://liminalvillage.gitbook.io/holons](https://liminalvillage.gitbook.io/holons)
>
> **User Guide**: See [docs/USER_GUIDE.md](docs/USER_GUIDE.md) for detailed user journeys and tutorials.

---

## Overview

Holons is an advanced, decentralized holonic platform built on Svelte 5 and TypeScript that enables organizations to manage themselves as **holons** - self-organizing units that are simultaneously whole and part of larger wholes.

The platform integrates blockchain smart contracts, federated data sharing, and real-time collaborative features to create a comprehensive ecosystem for:

- **Task & Project Management** - Quests and collaborative workflows
- **Resource Distribution** - Smart contract-based flow management
- **Federation** - Connect holons across organizations with capability-based access control

## Tech Stack

| Layer         | Technology                               |
| ------------- | ---------------------------------------- |
| Frontend      | Svelte 5, TypeScript, Tailwind CSS       |
| Build         | Vite, SvelteKit                          |
| Data          | HoloSphere (signed Nostr events, local store) |
| Blockchain    | Ethers.js v6, ERC20 tokens               |
| Maps          | Mapbox GL, H3-JS hexagonal indexing      |
| Visualization | D3.js                                    |
| AI/LLM        | OpenAI, Anthropic, Groq                  |

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- (Optional) Ethereum wallet for blockchain features

### Installation

```bash
# Clone the repository
git clone https://github.com/liminalvillage/holons.git
cd holons

# Install dependencies
npm install

# Start development server
npm run dev
```

### Available Scripts

| Command                    | Description                         |
| -------------------------- | ----------------------------------- |
| `npm run dev`              | Start development server            |
| `npm run build`            | Build for production                |
| `npm run preview`          | Preview production build            |
| `npm run check`            | Run type checking                   |
| `npm run lint`             | Run linter                          |
| `npm run format`           | Format code with Prettier           |
| `npm run deploy:localhost` | Deploy contracts to localhost       |
| `npm run deploy:sepolia`   | Deploy contracts to Sepolia testnet |
| `npm run deploy:gnosis`    | Deploy contracts to Gnosis chain    |

## Top 30 Features

### Dashboard & UI

1. **Multi-View Dashboard** - Central hub displaying statistics (users, tasks, events, shopping items, offers/needs, checklists, roles) with collapsible stat cards and quick navigation

2. **Responsive Layout System** - Desktop and mobile-optimized layout with sidebar navigation, top navigation bar, and draggable windows for flexible workspace management

3. **Advanced Calendar Views** - Multiple calendar display modes (month, week, day, orbits) with drag-and-drop task scheduling, external calendar integration (iCal), and real-time event sync

4. **Interactive Hexagonal Map** - H3-based geospatial mapping with Mapbox integration, layer filtering, search/geocoding, and multi-lens view selection (quests, offers, communities, organizations, projects, people)

5. **Visual Flow Visualization** - Canvas-based animation system showing internal/external flow distribution with nodes, edges, and real-time metrics

6. **Customizable Widget Dashboard** - Modular dashboard with widget positioning, theme customization, and persistent layout preferences

7. **Dark Mode & Theme System** - Tailwind CSS-based design system with configurable color schemes and visual themes

### Task & Project Management

8. **Quest Management System** - Task/quest creation with types (task, event, recurring, quest), status tracking (ongoing, completed, recurring), and multi-participant assignment

9. **Task Canvas View** - Visual task positioning and dependencies on interactive canvas with drag-and-drop organization

10. **Schedule Widget** - Integrated scheduling view with time-based task assignment and visual timeline representation

11. **Checklist Management** - Create and track multi-item checklists with completion status and progress visualization

### Data Management

13. **Shopping List Management** - Create and manage shopping items with categorization, status tracking, and shared visibility

14. **Expense Tracking & Credit Matrix** - Expense logging with split-payment calculations, credit matrix for inter-group accounting, and multi-currency support

15. **Role Management System** - Define organizational roles with participant assignment, zone allocation, and role-specific permissions

16. **Tag Management** - Flexible tagging system for categorizing and organizing all holon content

17. **Database Viewer (DB Panel)** - Direct view and manipulation of raw HoloSphere data for administrative purposes

### Blockchain & Smart Contracts

22. **Bundle Smart Contract System** - Deploy and manage Bundle contracts with interior/exterior zones, member management, and flow distribution

23. **Smart Contract Deployment** - Contract loader system supporting Managed, Zoned, Splitter, and Appreciative holon types with registry configuration

24. **Flow Split Management** - Adjust flow distribution between interior (members) and exterior (federated holons) with steepness and zone parameters

25. **Holon Manager Service** - Comprehensive contract management including member addition, zone assignment, balance queries, and event emission

### Federation & Integration

26. **Holonic Federation System** - Create federation links between holons with lens-based permissions (read/write/delete) and capability tokens

27. **Nostr-Based Messaging** - Integration with Nostr protocol for decentralized direct messaging and federation handshakes

28. **Capability-Based Access Control** - Issue and manage capability tokens with granular permissions (read, write, delete) and expiration settings

29. **Global Holon Registry** - Discover and browse all holons in the federated network with search and filtering

30. **Federation Navigator** - Browse and federate with remote holons, manage incoming/outgoing federation requests, and control lens-based data sharing

## Architecture

```
src/
├── components/          # Svelte UI components
│   ├── calendar/        # Calendar views and widgets
│   ├── flow/            # Flow visualization components
│   ├── map/             # Hexagonal map components
│   └── ...
├── dashboard/           # Dashboard panels and widgets
│   ├── browser/         # Data browser panels
│   ├── widgets/         # Dashboard widgets
│   └── ...
├── lib/                 # Core libraries
│   ├── holons/          # Holon management (contracts, settings)
│   ├── holosphere/      # HoloSphere data layer
│   └── contracts/       # Smart contract ABIs and bytecode
├── routes/              # SvelteKit routes
├── services/            # Business logic services
├── stores/              # Svelte stores for state management
├── types/               # TypeScript type definitions
└── utils/               # Utility functions and services
```

## Key Services

| Service           | Description                                          |
| ----------------- | ---------------------------------------------------- |
| `FlowSettings`    | Holon configuration, federation, and flow management |
| `HolonsManager`   | Smart contract interaction and event handling        |
| `HolonsContract`  | Low-level blockchain contract operations             |
| `QueryManager`    | Centralized HoloSphere data queries with caching     |
| `SessionManager`  | Design Streams session lifecycle management          |
| `QRActionService` | QR code action processing and dispatch               |

## Smart Contract Types

| Contract     | Purpose                                                             |
| ------------ | ------------------------------------------------------------------- |
| Bundle       | Primary contract with interior/exterior zones and member management |
| Managed      | Simpler contract with basic member and flow management              |
| Zoned        | Contract with multiple configurable zones                           |
| Splitter     | Flow distribution contract for payment splitting                    |
| Appreciative | Appreciative-based resource allocation                              |

## Quick Start for Users

1. **Visit the App**: Open Holons in your browser
2. **Create Identity**: Click "Keys & Access" in the sidebar, then "Create Identity"
3. **Explore Your Home**: Your personal holon is created automatically
4. **Add Holons**: Use the "+" button to add other holons by ID or QR code
5. **Navigate**: Use the top tabs to access Tasks, Schedule, Expenses, and more

For detailed user journeys, see the [User Guide](docs/USER_GUIDE.md).

---

## Documentation

| Resource                                                          | Description                    |
| ----------------------------------------------------------------- | ------------------------------ |
| [GitBook Documentation](https://liminalvillage.gitbook.io/holons) | Full platform documentation    |
| [User Guide](docs/USER_GUIDE.md)                                  | User journeys and tutorials    |
| [Architecture Guide](docs/ARCHITECTURE.md)                        | Technical architecture details |
| [Quick Reference](docs/QUICK_REFERENCE.md)                        | Key files and data flow        |

---

## License

AGPL License - See LICENSE file for details.

## Author

Roberto Valenti

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

---

## Support

- **Documentation**: [GitBook](https://liminalvillage.gitbook.io/holons)
- **Issues**: [GitHub Issues](https://github.com/liminalvillage/holons/issues)
- **User Guide**: [docs/USER_GUIDE.md](docs/USER_GUIDE.md)
