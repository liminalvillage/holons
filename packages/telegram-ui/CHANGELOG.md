# Changelog

The complete history of HolonsBot — from first commit to decentralized community platform.

---

## [2.0.0-alpha] - December 2025

### REA Accounting Revolution
- **Event-Sourced Architecture** - Complete REA (Resource-Event-Agent) implementation for immutable economic tracking
- **REAEventStore** - Persistent storage for all community transactions
- **REAEventFactory** - Structured event creation for quests, expenses, appreciation, library items
- **REAAggregator** - Real-time computation of balances, scores, and activity summaries

### HoloSphere 2.0 Migration
- **Nostr Backend** - Decentralized storage on the Nostr protocol
- **Optimized Communications** - Faster relay synchronization
- **Settings & Language Caching** - Instant preference switching

### Architecture Modernization
- **Dependency Injection** - ServiceContainer pattern for clean architecture
- **Modular Structure** - Reorganized into `core/`, `src/`, `utils/`
- **SignalManager** - Event-driven action handling
- **JSDoc Documentation** - Complete API docs for all classes

---

## [1.3.0] - October-November 2025

### Nostr Integration
- **Hologram Publishing on Nostr** - First working decentralized quest sharing
- **Custom Relay Configuration** - User-configurable Nostr endpoints
- **InputScene Utility** - Reusable text input pattern

---

## [1.2.0] - September 2025

### Architecture Refactor
- **Dependency Injection** - Clean separation of concerns
- **Quest Dependencies** - Link quests with prerequisites
- **Schema Definitions** - JSON schemas for data validation

---

## [1.1.0] - June-August 2025

### Visual Quest System
- **Image-Based Quest Cards** - Rich visuals generated with Puppeteer
- **Fast Mode** - Sub-second image generation
- **Text Mode** - Lightweight fallback option
- **Smart Caching** - Background regeneration for performance

### Blockchain Rewards
- **Sepolia Testnet Deployment** - Fresh smart contract batch
- **ETH/ERC20 Distribution** - Rewards aligned with federation
- **Score-Based Weights** - Custom currency in calculations
- **Hours as Default Currency** - Time as primary value metric

### Federation Enhancements
- **Federated Announcements** - Cross-community updates
- **Subchannel Isolation** - Tasks scoped to channels
- **QR Code Commands** - Scan to execute actions
- **Dashboard QR Codes** - Share holon access instantly

### Infrastructure
- **Removed IPFS/OrbitDB** - Simplified to radisk storage
- **Security Hardening** - File endpoints, rate limiting
- **Parallel Reset** - Faster holon clearing

---

## [1.0.0] - March-May 2025

### Federation Controls
- **Admin Selector** - Manage holon administrators
- **Federation UI** - Visual controls for linking holons
- **User Join by Handle** - Add members by username
- **Improved Onboarding** - Better welcome flow

### Quest Enhancements
- **Task Dependencies** - Chain quests together
- **Recurring Controls** - Fine-tune repeat schedules
- **Global Reminders** - Persistent reminder storage
- **Task Checklists** - Subtasks on any quest
- **Time Expense Tracking** - Log hours to tasks

### Settings Overhaul
- **New Settings Interface** - User-friendly menus
- **In-Place Editing** - Smooth configuration updates

---

## [0.9.0] - December 2024 - February 2025

### HoloSphere 1.1
- **Profile Storage** - User data on HoloSphere
- **Soul-Based Casting** - First publish/cast implementation
- **HTTPS Support** - SSL certificates for secure endpoints
- **Default Avatars** - Fallback profile images

### Expense Improvements
- **Dashboard Links** - Quick access from expenses
- **User ID Only** - Simplified expense tracking

---

## [0.8.0] - September-November 2024

### Multi-Platform
- **Discord Integration** - Bot works on Discord
- **Multibot Architecture** - Run multiple instances
- **Gnosis Chain** - Smart contracts on Gnosis

### New Features
- **Announcements** - Community-wide messages
- **Library System** - Item lending with credits
- **Checklist Module** - Standalone list management
- **Multi-Item Add** - Batch checklist entries
- **6 Languages** - German, Spanish, Portuguese, French, Dutch

### Admin Controls
- **Admin-Only Functions** - Restricted commands
- **Cancel/Complete by Admin** - Override task status

---

## [0.7.0] - May-August 2024

### Database Evolution
- **HoloSphere Integration** - Wired decentralized storage
- **Removed OrbitDB** - Cleaner architecture
- **RSVP Functions** - Event attendance tracking

### Expense Features
- **Add/Remove from Split** - Flexible expense sharing
- **Expense Totals** - Balance summaries
- **Currency Fixes** - Multi-currency support

### Technical
- **Multi-Environment** - `--env-file` support
- **Configurable App Name** - Per-instance branding
- **Role Images** - Visual role representation

---

## [0.6.0] - January-April 2024

### Major Migration
- **Gun.js Database** - Massive migration from OrbitDB
- **Participation System** - Join/leave quests
- **Profile Scenes** - Edit user data in-place

### New Capabilities
- **Expense Splitter** - First implementation
- **Onboarding Wizard** - Guided setup flow
- **AI Assistants** - Upgraded to OpenAI Assistants API
- **H3 Geospatial** - Hexagonal location indexing
- **Tags System** - Quest categorization
- **Ontology AI** - Smart categorization

---

## [0.5.0] - September-December 2023

### Value System
- **Value Cloud** - Visual value representation
- **Intersubjective Values** - Community-defined worth
- **Money & Hour Credits** - Dual currency system
- **Balance Function** - Track community wealth
- **Harvest Board** - Community dashboard

### Quest Types
- **Events** - Scheduled gatherings
- **Needs & Values** - Community declarations
- **Any-Type Quests** - Flexible task creation

### Infrastructure
- **Holons Sync** - First blockchain integration
- **Centralized DB Management** - OrbitDB/Gun unified

---

## [0.4.0] - August-September 2023

### Federation Launch
- **Metafest Version** - First federated deployment
- **Cross-Holon Tasks** - Share quests between communities
- **Federation Database** - Dedicated sync layer
- **Appreciation After Completion** - Post-task kudos

### Calendar
- **In-Place Calendar** - Edit without new messages
- **Calendar on Federation** - Cross-holon scheduling

---

## [0.3.0] - May-July 2023

### Core Features
- **QR Code Scanner** - Read codes to trigger actions
- **Task Pinning** - Pin tasks, unpin on complete
- **Image Tasks** - Attach photos to quests
- **Roles System** - Community role management
- **Lunation Functions** - Moon phase tracking

### Lists & Reminders
- **Shopping Lists** - Collaborative shopping
- **Reminder System** - Scheduled notifications
- **Value Function Selector** - Custom scoring formulas
- **Bulletin Board** - Offers & wants display

### AI Integration
- **ChatGPT 3.5** - AI-powered suggestions
- **Today Command** - AI daily summary
- **Role Detection** - Smart role assignment

---

## [0.2.0] - February-April 2023

### Quest System
- **Requests & Offers** - Community exchange
- **Appreciation System** - Send kudos to contributors
- **User Actions Tracking** - Record contributions
- **Quest Types** - Task categorization

### Internationalization
- **i18n Support** - Multi-language foundation
- **Theme System** - Light/dark modes
- **Settings Module** - User preferences

### Infrastructure
- **Production Settings** - Deployment configuration
- **IPFS Stability** - Lock file fixes

---

## [0.1.0] - January 2023

### The Beginning
- **First OrbitDB Implementation** - Decentralized storage foundation
- **DocStore Backend** - Document-based data model
- **Multi-Chat Support** - Bot works across groups
- **Quest Module** - Core task management
- **Approval Workflow** - Task validation system
- **Credit System** - Send credits on completion
- **Join/Appreciate Toggle** - Participation controls

---

## Project Timeline

| Year | Milestone |
|------|-----------|
| 2023 | OrbitDB foundation, quest system, federation, AI |
| 2024 | Gun.js migration, HoloSphere, multibot, Discord |
| 2025 | Visual UI, Nostr, REA accounting, HoloSphere 2.0 |

---

*From a buggy OrbitDB experiment to a decentralized community coordination platform.*

*Built with passion since January 2023.*
