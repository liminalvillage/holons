# HolonsBot

A decentralized community coordination platform built as a Telegram bot, enabling collaborative task management, resource sharing, expense tracking, and community governance through the HoloSphere ecosystem.

## What is HolonsBot?

HolonsBot transforms Telegram groups into self-organizing communities (called "holons") with tools for:

- **Collective Task Management** - Create quests, tasks, and proposals that members can join, complete, and track
- **Resource Coordination** - Share offers, needs, and track contributions using REA (Resource-Event-Agent) accounting
- **Expense Splitting** - Track shared expenses and automatically calculate balances between members
- **Community Governance** - Define roles, values, and manage member contributions
- **Federation** - Connect multiple holons to share quests and resources across communities

All data is stored on a decentralized network using HoloSphere/Nostr, meaning communities own their data.

## Key Features

### Quest System
Create and manage various types of collaborative tasks:
- **Tasks** (`/task`) - Work items that need doing
- **Events** (`/event`) - Scheduled gatherings or activities
- **Proposals** (`/proposal`) - Ideas for community decision
- **Offers** (`/offer`) - Resources or skills being offered
- **Requests** (`/request`) - Needs the community can help with

Quests support:
- Participation tracking (join/leave)
- Time logging for contributors
- Completion workflow with appreciation
- Scheduling and reminders
- Checklists for subtasks
- Image-based or text-based display

### Hologram System
Live-updating references that sync across holons:
- **Telegram Holograms** - Messages that auto-update when source data changes
- **Personal Holograms** - User-specific views stored in personal data space
- **Federation Holograms** - Quests shared across connected holons

### Expense Tracking
Built-in expense splitting for shared costs:
- `/expense` or `/spent` - Record an expense
- Automatic participant selection
- Balance calculation per member
- Multi-currency support
- REA event-sourced accounting

### Role Management
Define community roles with associated responsibilities:
- `/roles` - View all roles
- `/addrole` - Create new roles
- Role-based checklists
- Member assignment

### Checklists & Shopping Lists
Collaborative list management:
- `/checklist` - Create/view checklists
- `/shopping` - Shopping list with toggle items
- `/agenda` - Schedule-based checklists

### Scheduling & Reminders
Task scheduling with calendar interface:
- `/when` - Schedule a quest with date/time picker
- `/recurring` - Set up repeating tasks
- Automatic reminder notifications

### Federation
Connect holons for cross-community collaboration:
- `/spoon` or `/federate` - Link to another holon
- `/fork` or `/separate` - Unlink from a holon
- Configure which lenses (quests, offers, etc.) to share
- Holograms automatically propagate to federated holons

### Leaderboard & Appreciation
Track community contributions:
- `/leaderboard` - View member scores
- Configurable value equation for scoring
- REA-based appreciation tracking

### Settings & Configuration
Comprehensive holon customization:
- `/settings` - Interactive settings menu
- Language selection (en, it, es, fr, ru, de)
- Theme (light/dark)
- Admin management
- Custom values and domains

## Architecture

```
HolonsBot/
├── core/                    # Core infrastructure
│   ├── HolonsBotCore.js    # Main application entry
│   ├── ServiceContainer.js  # Dependency injection
│   ├── SignalManager.js     # Action/callback management
│   └── ServiceDefinitions.js # Service registration
├── src/                     # Feature modules
│   ├── Quests.js           # Quest management
│   ├── Settings.js         # Configuration
│   ├── Users.js            # User management
│   ├── Expenses.js         # Expense tracking
│   ├── Holons.js           # Blockchain operations
│   ├── Scheduler.js        # Task scheduling
│   ├── Checklists.js       # List management
│   ├── Shopping.js         # Shopping lists
│   ├── Roles.js            # Role management
│   ├── UI.js               # Visual output
│   ├── DB.js               # Database abstraction
│   ├── Calendar.js         # Date/time picker
│   └── domain/rea/         # REA accounting
│       ├── REAEventStore.js
│       ├── REAEventFactory.js
│       └── REAAggregator.js
└── utils/                   # Utilities
    ├── InputScene.js       # User input handling
    ├── config.js           # Configuration
    └── errorHandler.js     # Error management
```

### Technology Stack

| Component | Technology |
|-----------|------------|
| Bot Framework | Telegraf.js |
| Database | HoloSphere.js (Nostr backend) |
| Blockchain | Ethers.js (optional) |
| Scheduling | node-cron |
| i18n | i18next |
| Image Generation | Puppeteer |
| Geospatial | h3-js |

## Getting Started

### Prerequisites
- Node.js 18+
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/HolonsBot.git
cd HolonsBot

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your bot token and settings

# Start the bot
npm start
```

### Environment Variables

```bash
# Required
TELEGRAM_BOT_TOKEN=your_bot_token

# Optional
APPNAME=Holons                    # Application name
LANGUAGE=en                       # Default language
DASHBOARD_ADDRESS=https://...     # Web dashboard URL
SHOW_QUESTS_AS_IMAGES=true       # Enable image mode
QUEST_IMAGE_FAST_MODE=false      # Use simplified images
NODE_ENV=development             # Environment mode
```

## Commands Reference

### Quests
| Command | Description |
|---------|-------------|
| `/quest`, `/task` | Create a new quest/task |
| `/event` | Create an event |
| `/proposal` | Create a proposal |
| `/offer` | Create an offer |
| `/request` | Create a request |
| `/tasks`, `/todos` | View all tasks |
| `/offers` | View all offers |
| `/requests` | View all requests |

### Expenses
| Command | Description |
|---------|-------------|
| `/expense`, `/spent` | Record an expense |
| `/ledger` | View expense ledger |

### Lists
| Command | Description |
|---------|-------------|
| `/checklist` | View/create checklist |
| `/shopping` | Shopping list |
| `/agenda` | Agenda checklist |

### Community
| Command | Description |
|---------|-------------|
| `/roles` | View roles |
| `/leaderboard` | View scores |
| `/join` | Join the holon |
| `/leave` | Leave the holon |

### Settings
| Command | Description |
|---------|-------------|
| `/settings` | Open settings menu |
| `/setlanguage` | Change language |
| `/id` | Show holon ID |

### Federation
| Command | Description |
|---------|-------------|
| `/spoon`, `/federate` | Link to another holon |
| `/fork`, `/separate` | Unlink from holon |
| `/federation` | View federation status |

## Development

```bash
# Development with auto-reload
npm run dev

# Run tests
npm test

# Lint code
npm run lint

# Generate documentation
npm run docs
```

## API Documentation

JSDoc documentation is available for all classes. Generate it with:

```bash
npm run docs
open docs/api/index.html
```

## Quest Display Modes

### Standard Mode
Full-featured quest images with smart caching and background regeneration.

### Fast Mode (`QUEST_IMAGE_FAST_MODE=true`)
Simplified images for maximum speed (< 1 second generation).

### Text Mode (`SHOW_QUESTS_AS_IMAGES=false`)
Text-only display for low-resource environments.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

## License

GPL-3.0-only - See [LICENSE](LICENSE) for details.

## Links

- [HoloSphere Documentation](https://holosphere.io/docs)
- [Telegraf.js Documentation](https://telegraf.js.org)
