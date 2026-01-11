# Harvest User Guide

Welcome to **Harvest** - a decentralized holonic platform for organizational governance, resource distribution, and wisdom aggregation.

> **Full Documentation**: For comprehensive documentation, visit our [GitBook](https://liminalvillage.gitbook.io/harvest)

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Core Concepts](#core-concepts)
3. [User Journeys](#user-journeys)
4. [Features Guide](#features-guide)
5. [Key Management](#key-management)
6. [Troubleshooting](#troubleshooting)

---

## Getting Started

### First Time Setup

1. **Visit Harvest**: Open the application in your browser
2. **Identity Setup**: You'll start in "Guest Mode" - a public browsing experience
3. **Create Your Identity**: Click "Keys & Access" in the sidebar and select "Create Identity" to generate your unique cryptographic key pair
4. **Access Your Home**: Your personal holon (your "Home") is automatically created using your public key

### The Interface

The Harvest interface consists of three main areas:

- **Sidebar (Left)**: Holon browser and identity management
  - Home holon (always at top when viewing "My Holons")
  - Starred/pinned holons
  - Recent holons
  - Federated holons
- **Top Navigation (Top)**: Feature tabs for the current holon
- **Content Area (Center)**: The main workspace

---

## Core Concepts

### What is a Holon?

A **holon** is a self-organizing unit that is simultaneously whole in itself AND part of larger wholes. In Harvest:

- **Your Home Holon**: Your personal space tied to your identity
- **Team Holons**: Collaborative spaces for groups
- **Organization Holons**: Larger entities containing multiple teams
- **Ecosystem Holons**: Networks of organizations

### Identity & Keys

Harvest uses cryptographic keys for identity:

- **Private Key**: Your secret - never share it! Used to sign your actions
- **Public Key**: Your identifier - shareable with others
- **Guest Mode**: Browse without a key (limited functionality)

### Federation

Holons can federate with each other, creating networks of interconnected spaces with controlled data sharing through "lenses."

---

## User Journeys

### Journey 1: New User Onboarding

```
Start
  |
  v
[Visit Harvest] --> [Land in Guest Mode]
  |
  v
[Explore the interface] --> [See "Guest Mode" in sidebar]
  |
  v
[Click "Keys & Access"] --> [See identity options]
  |
  v
[Choose "Create Identity"] --> [Generate new key pair]
  |
  v
[Page reloads] --> [Now in "Private" mode with your identity]
  |
  v
[Your Home holon appears] --> [Start organizing!]
```

**Steps:**
1. Open Harvest in your browser
2. Notice you're in "Guest Mode" (green badge in sidebar)
3. Expand "Keys & Access" section
4. Click "Create Identity" to generate your keys
5. Your home holon automatically becomes available
6. Start creating tasks, events, and more!

---

### Journey 2: Joining an Existing Holon

```
Start
  |
  v
[Receive holon ID or QR code from organizer]
  |
  v
[Click "+" button in sidebar] --> [Add Holon modal opens]
  |
  v
[Enter holon ID or scan QR] --> [Holon added to your list]
  |
  v
[Click the holon] --> [Navigate to holon dashboard]
  |
  v
[Explore features] --> [View tasks, events, roles, etc.]
```

**Steps:**
1. Get a holon ID from the holon organizer (or scan their QR code)
2. Click the "+" button in the sidebar header
3. Enter the holon ID or use the QR scanner
4. Optionally add a display name
5. Click "Add Holon"
6. The holon appears in your list - click to enter

---

### Journey 3: Creating and Managing Tasks

```
Start (in a holon)
  |
  v
[Click "Tasks" tab] --> [View task list]
  |
  v
[Click "+" to create task] --> [Task modal opens]
  |
  v
[Fill in details] --> [Set title, type, participants, due date]
  |
  v
[Save task] --> [Task appears in list]
  |
  v
[Click task to view/edit] --> [Update status, add notes]
  |
  v
[Mark complete] --> [Task moves to completed]
```

**Task Types:**
- **Task**: One-time action items
- **Event**: Scheduled occurrences with date/time
- **Recurring**: Repeated tasks on a schedule
- **Quest**: Larger initiatives with multiple steps

---

### Journey 4: Managing Your Identity

```
Start
  |
  v
[Expand "Keys & Access" in sidebar]
  |
  v
[View your current identity status]
  |
  +--[Export Key] --> [View and copy your private key for backup]
  |
  +--[Switch Identity] --> [Import a different key]
  |
  +--[Logout] --> [Return to Guest Mode]
```

**Important:**
- Always backup your private key securely
- If you lose your key, you lose access to your identity
- Never share your private key with anyone

---

### Journey 5: Federating with Other Holons

```
Start (in your holon)
  |
  v
[Click "Federation" tab] --> [View federation status]
  |
  v
[Click "Add Federation"] --> [Enter target holon ID]
  |
  v
[Configure lenses] --> [Choose what data to share]
  |
  v
[Send federation request] --> [Wait for approval]
  |
  v
[Federation active] --> [Shared data visible to both holons]
```

**Federation Lenses:**
- Quests/Tasks
- Offers/Requests
- Tags
- Expenses
- Announcements
- Users
- Shopping lists
- Recurring items

---

### Journey 6: Using the Calendar

```
Start (in a holon)
  |
  v
[Click "Schedule" tab] --> [View calendar]
  |
  v
[Choose view mode] --> [Month / Week / Day / Orbits]
  |
  v
[Click a date] --> [Create new event]
  |
  v
[Drag events] --> [Reschedule items]
  |
  v
[Click event] --> [View/edit details]
```

---

### Journey 7: Expense Tracking

```
Start (in a holon)
  |
  v
[Click "Expenses" tab] --> [View expense list]
  |
  v
[Click "+" to add expense] --> [Fill in details]
  |
  v
[Add amount, category, participants] --> [Save expense]
  |
  v
[View credit matrix] --> [See who owes whom]
```

---

## Features Guide

### Dashboard
Central hub displaying statistics and quick navigation to all features.

### Tasks
Manage tasks, quests, and action items with status tracking and participant assignment.

### Schedule
Calendar views with drag-and-drop scheduling and external calendar integration.

### Expenses
Track expenses with split payments and credit matrix calculations.

### Roles
Define and assign organizational roles with permissions.

### Map
Hexagonal geospatial mapping for location-based visualization.

### Offers & Requests
Resource exchange marketplace within and across holons.

### Shopping List
Collaborative shopping lists with categorization.

### Checklists
Multi-item checklists with progress tracking.

### Status
Holon health monitoring and status indicators.

### Federation
Connect with other holons and manage data sharing.

### Flow
Visualize resource distribution between interior and exterior zones.

### Settings
Configure holon properties, appearance, and blockchain integration.

### Database
Direct view of HoloSphere data for administrative purposes.

---

## Key Management

### Creating a New Identity

1. Expand "Keys & Access" in the sidebar
2. Click "Create Identity"
3. A new cryptographic key pair is generated
4. Your identity is now active

### Backing Up Your Key

1. Expand "Keys & Access"
2. Click "Export Key"
3. Your private key is displayed
4. Copy and store it securely (password manager, encrypted note, etc.)

**Warning**: If you lose your private key and don't have a backup, your identity is unrecoverable.

### Importing an Existing Key

1. Expand "Keys & Access"
2. Click "Switch Identity" or "Import Key"
3. Enter your 64-character hex private key
4. Click "Import Key"

### Logging Out

1. Expand "Keys & Access"
2. Click "Logout"
3. You return to Guest Mode
4. Your data remains - you can import your key again to access it

---

## Troubleshooting

### Can't see my holons
- Check that you're logged in (not in Guest Mode)
- Verify you've added holons to your starred list
- Try refreshing the page

### Page not loading
- Check your internet connection
- Clear browser cache and reload
- Try a different browser

### Lost my private key
- Unfortunately, keys cannot be recovered
- Create a new identity
- Contact holon administrators to be re-added to holons

### Federation not working
- Ensure both holons have approved the federation
- Check that appropriate lenses are enabled
- Verify network connectivity

---

## Quick Reference

| Shortcut | Action |
|----------|--------|
| Click Home | Return to your personal holon |
| Click "+" | Add a new holon |
| Hamburger menu | Toggle sidebar |
| Ctrl+Shift+Z | Toggle widget dashboard |

---

## Getting Help

- **Documentation**: [GitBook](https://liminalvillage.gitbook.io/harvest)
- **Issues**: [GitHub Issues](https://github.com/liminalvillage/harvest/issues)
- **Community**: Join our Telegram group via the app

---

*Last updated: January 2026*
