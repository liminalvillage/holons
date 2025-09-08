# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

HolonsBot is a multifaceted Telegram bot built with Telegraf.js and leveraging HoloSphere.js for decentralized data management. It serves as a comprehensive platform for community interaction, quest management, and data organization within the HoloSphere ecosystem.

## Development Commands

### Starting the Application
```bash
# Start the bot in production mode
npm start

# Start the bot in development mode with auto-restart
npm run dev
```

### Testing
The project has custom test files in the `tests/` directory. Run individual tests:
```bash
# Run a specific test
node tests/questest.js
node tests/map-button.test.js
node tests/webapp-closing.test.js
node tests/webapp-hex-handler.test.js
```

Note: The npm test script is not configured (`echo "Error: no test specified" && exit 1`).

## Core Architecture

### Main Entry Points
- **HolonsBot.js**: Main application entry point that initializes the Telegraf bot, loads all modules, and handles Discord integration
- **Server.js**: Express server that handles HTTP/HTTPS endpoints, static file serving, avatar endpoints, and image generation with security middleware

### Data Management
- **DB.js**: Database abstraction layer
- **HoloSphere**: Primary data storage using Gun.js as the underlying decentralized database
- **holosphere/**: Contains HoloSphere configuration and data files

### Core Modules
- **Quests.js**: Quest management system with hologram live-updating features
- **Holons.js**: Holon-centric operations and views
- **Settings.js** & **SettingsScenes.js**: User and chat configuration management
- **Scheduler.js**: Task scheduling and reminders system
- **Users.js**: User data and preference management

### Feature Modules
- **Expenses.js**: Expense tracking and balance management
- **Checklists.js**: Checklist functionality
- **Shopping.js**: Shopping list management
- **Council.js** & **Roles.js**: Community governance and role management
- **Bigtalk.js**: Community conversation prompts
- **Calendar.js**: Calendar and scheduling features
- **QRCodeInterpreter.js**: QR code scanning and action execution
- **AI.js**: OpenAI integration for AI-powered features

### UI and Utilities
- **UI.js**: User interface components and message formatting
- **utilities.js**: General utility functions
- **H3.js**: Geospatial indexing using h3-js

## Key Technologies

- **Backend**: Node.js with ES Modules (`"type": "module"`)
- **Bot Framework**: Telegraf.js (Telegram) + Discord.js
- **Database**: HoloSphere.js (decentralized) with Gun.js
- **Web Server**: Express.js with HTTPS support
- **Image Processing**: Sharp, Jimp, Puppeteer for quest image generation
- **QR Codes**: QR code generation and reading capabilities
- **Scheduling**: Custom scheduler with cron support
- **Internationalization**: i18next
- **Blockchain**: Ethers.js and Web3.js for blockchain integration

## Configuration

### Environment Variables
Key environment variables (defined in `.env`):
- `SHOW_QUESTS_AS_IMAGES=true`: Enable quest image generation
- `QUEST_IMAGE_FAST_MODE=true`: Enable simplified fast images
- `NODE_ENV=development`: Development mode for HTTP server (production uses HTTPS)
- `PORT`: Server port (defaults to 8080 in dev, 443 in production)

### Performance Modes
The bot supports three quest display modes:
1. **Standard Mode**: Full-featured images with smart caching
2. **Fast Mode**: Simplified images for speed
3. **Text Mode**: Text-only display for maximum performance

## Core Concepts

### Hologram System
- **Telegram Holograms**: Live-updating messages that mirror original quest data
- **Personal Data Holograms**: User-specific views stored in `userId/quests`
- Links stored in `activeHolograms` arrays with conditional logic to prevent duplication

### Data Architecture
- **Decentralized Storage**: Uses HoloSphere for distributed data management
- **Soul-linking**: Data relationships managed through HoloSphere's soul concept
- **Personal Holons**: User-specific data spaces for personalized views
- **Federation**: Chat federation system using `/spoon` and `/fork` commands

### Smart Contracts
The `contracts/` directory contains Ethereum smart contracts for:
- Holon management
- Resource factories
- Zoned systems
- Token management

## File Structure

### Data Directories
- `data/`: Application data files
- `radata/`: Gun.js/HoloSphere data storage
- `images/`: Generated and uploaded images
- `templates/`: Template files
- `public/`: Static web assets
- `certs/`: SSL certificates for HTTPS

### Configuration Files
- `jsconfig.json`: JavaScript configuration (ES6 target)
- `.gitignore`: Excludes data directories, environment files, and generated content
- `COMMANDS.md`: Complete command reference documentation
- `QR_CODE_SYSTEM.md`: QR code functionality documentation

## Security Features
- HTTPS support with certificate management
- Request rate limiting
- Secure static file serving with dotfile denial
- Input validation and sanitization
- Environment variable protection