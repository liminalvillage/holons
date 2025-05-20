# HolonsBot

## Overview

HolonsBot is a multifaceted Telegram bot built with Telegraf.js and leveraging HoloSphere.js for its core data management. Initially focused on quest management with an innovative "hologram" system for live-updating views, the project has expanded to encompass a wider range of functionalities, becoming a more general-purpose platform for community interaction and data organization within the HoloSphere ecosystem.

**Core Functionalities Include:**

*   **Quest Management:** Allows users to create, manage, and interact with various types of quests (tasks, events, proposals, etc.). This includes features like joining, appreciating, scheduling, completing, and time tracking.
*   **Hologram System:**
    *   **Telegram Holograms:** Live-updating Telegram messages that mirror original quest data. Links to these are stored in the original quest's `activeHolograms` array.
    *   **Personal Data Holograms:** HoloSphere.js objects in a user's personal holon (`userId/quests`) that link to original quest data, providing a personalized view and activity log.
    *   Conditional logic prevents redundant hologram creation.
*   **Holons Management:** While much interaction is via HoloSphere, dedicated logic in `Holons.js`  supports specific holon-centric operations or views.
*   **Settings Management:** Users and chats can configure various settings, managed through dedicated commands and scenes (`Settings.js`, `SettingsScenes.js`).
*   **Task Scheduling:** A robust scheduler (`Scheduler.js`) handles reminders for quests and manages recurring tasks.
*   **User Management:** Tracks user data, preferences (beyond general settings), and actions within the bot (`Users.js`).
*   **Data Persistence & Abstraction:** Primarily uses HoloSphere.js for data storage. `DB.js` might provide an abstraction layer or specific database utilities.
*   **Additional Features:** The codebase includes modules for various other functionalities such as `Expenses.js`,  `Checklists.js`, `Bigtalk.js`, `Shopping.js`, `Council.js`, and `Roles.js`, indicating a broad feature set.

The bot is designed with modularity in mind, though some core files (`Quests.js`, `Holons.js`, `Settings.js`) are extensive and are candidates for future refactoring. The project aims for robust data consistency, particularly between original data entities and their various hologrammatic representations.

## Patterns and Technologies Used

*   **Backend Framework:** Telegraf.js (for Telegram bot functionality)
*   **Database/Data Management:**
    *   HoloSphere.js
    *   Gun.js (underlying HoloSphere)
    *   Potentially custom database abstraction (`DB.js`)
*   **Programming Language:** JavaScript (ES Modules)
*   **Internationalization (i18n):** i18next
*   **Scheduling:** Custom scheduler (`Scheduler.js`)
*   **Core Concepts:**
    *   Telegram Bots & API features (Commands, Callbacks, Scenes)
    *   Modular design (with ongoing refactoring needs for large files)
    *   Real-time message updates (Holograms)
    *   Decentralized data storage concepts (via HoloSphere)
    *   User-specific data spaces (Personal Holons)
    *   Soul-linking for data relationships in HoloSphere
    *   Community and role-based interactions (implied by `Council.js`, `Roles.js`)
*   **Geospatial Indexing:** h3-js (available in HoloSphere, used in `H3.js`)
*   **JSON Schema Validation:** Ajv2019 (available in HoloSphere)
*   **AI Integration:** OpenAI (optional, via `AI.js` and HoloSphere capabilities)
*   **Utilities:** Various helper modules for UI (`UI.js`), calendar (`Calendar.js`), general utilities (`utilities.js`), etc. 