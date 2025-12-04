# WebSocket & Relay Documentation Index

This directory contains comprehensive documentation about the WebSocket, relay, and notification systems used in the Harvest + HolonsBot ecosystem.

## Documents

### 1. **WEBSOCKET_RELAY_ANALYSIS.md** (Main Reference)
Complete technical analysis of the entire architecture with 13 detailed sections:
- Executive summary of Nostr-based relay system
- Relay server infrastructure details
- Harvest app WebSocket setup
- HolonsBot relay integration
- GunDB WebSocket proxy
- HoloSphere library documentation
- Notification system implementation
- Data flow diagrams
- Environment configuration
- Current limitations and recommendations

**Best for**: Deep technical understanding, troubleshooting, implementation details

---

### 2. **QUICK_REFERENCE.md** (Fast Lookup)
Quick lookup guide for developers:
- Key files at a glance
- Relay configuration examples
- Data flow summaries
- Configuration variables
- Common issues and fixes
- Port reference table
- Event flow architecture
- Notification system overview
- Useful commands

**Best for**: Quick answers, common problems, command reference

---

### 3. **SEARCH_RESULTS_SUMMARY.txt** (This Report)
Structured summary of all search results with:
- File paths with absolute locations
- Key findings and architecture overview
- Detailed sections for each component
- Environment variables
- Data synchronization flows
- Limitations and gaps
- Reference tables

**Best for**: Verification, file navigation, understanding what was searched

---

## Quick Navigation

### I Need to Understand...

**How relays are configured?**
- Read: QUICK_REFERENCE.md → "Relay Configuration"
- Read: WEBSOCKET_RELAY_ANALYSIS.md → "Section 1: RELAY SERVER INFRASTRUCTURE"
- See: `/Users/roberto/Projects/HolonsBot/relay-config.js`

**How Harvest connects to relays?**
- Read: QUICK_REFERENCE.md → "WebSocket Connection Ports"
- Read: WEBSOCKET_RELAY_ANALYSIS.md → "Section 2: HARVEST APP WEBSOCKET SETUP"
- See: `/Users/roberto/Projects/harvest/src/routes/+layout.svelte`

**How HolonsBot manages relay connections?**
- Read: WEBSOCKET_RELAY_ANALYSIS.md → "Section 3: HOLONSBOT WEBSOCKET & RELAY INTEGRATION"
- See: `/Users/roberto/Projects/HolonsBot/DB.js`
- See: `/Users/roberto/Projects/HolonsBot/relay-config.js`

**How WebSocket proxying works?**
- Read: WEBSOCKET_RELAY_ANALYSIS.md → "Section 4: GUNDB WEBSOCKET PROXY"
- See: `/Users/roberto/Projects/HolonsBot/proxy.js`
- See: `/Users/roberto/Projects/HolonsBot/GunServer.js`

**How the HoloSphere library manages connections?**
- Read: WEBSOCKET_RELAY_ANALYSIS.md → "Section 6: HOLOSPHERE LIBRARY"
- See: `/Users/roberto/Projects/holosphere2/src/core/holosphere.js`
- See: `/Users/roberto/Projects/holosphere2/src/storage/nostr-client.js`

**How notifications work?**
- Read: WEBSOCKET_RELAY_ANALYSIS.md → "Section 7: HOLONSBOT NOTIFICATION SYSTEM"
- Read: QUICK_REFERENCE.md → "Notification System (Current)"
- See: `/Users/roberto/Projects/HolonsBot/Announcements.js`

**What are the current limitations?**
- Read: WEBSOCKET_RELAY_ANALYSIS.md → "Section 12: CURRENT NOTIFICATION SYSTEM LIMITATIONS"
- Read: QUICK_REFERENCE.md → "Next Steps for Real-Time Notifications"

**How to fix a specific problem?**
- Read: QUICK_REFERENCE.md → "Common Issues & Fixes"

**Where exactly is file X located?**
- Read: SEARCH_RESULTS_SUMMARY.txt → "Section 7: FILE STRUCTURE & ABSOLUTE PATHS"

---

## Architecture at a Glance

```
┌────────────────────────────────────────────────────────┐
│ Harvest App (SvelteKit)                                │
│ HoloSphere instance in +layout.svelte                  │
│ Relays: ws://localhost:7777, wss://relay.nostr.band   │
└───────────┬──────────────────────────────────────────┬─┘
            │                                          │
     ┌──────▼──────────────┐              ┌───────────▼────────┐
     │ Nostr Relay Network │◄─────────────┤ HolonsBot          │
     │ ws://localhost:7777 │              │ DB class manages   │
     │ wss://relay.nostr.  │              │ relay connections  │
     │ band                │              └────────┬───────────┘
     └──────┬──────────────┘                       │
            │                                      │
     ┌──────▼──────────────────┐                  │
     │ GunServer P2P Sync      │◄─────────────────┘
     │ localhost:8765          │
     │ WebSocket middleware    │
     └────────────────────────┘
```

---

## Key Findings Summary

### Architecture Type
- **NOT** traditional WebSocket servers
- **IS** Nostr-based protocol with cryptographic signatures
- **Uses** SimplePool for relay management
- **Includes** GunDB for peer-to-peer sync

### Relay Configuration
- Primary: `ws://localhost:7777` (custom relay, real-time)
- Fallback: `wss://relay.nostr.band` (public relay, persistence)
- Shared between Harvest and HolonsBot via private key

### Key Components
1. HoloSphere Library (`/holosphere2/src/core/`)
2. NostrClient with SimplePool (`/holosphere2/src/storage/`)
3. Database Wrapper (`/HolonsBot/DB.js`)
4. Announcement System (`/HolonsBot/Announcements.js`)
5. WebSocket Proxy (`/HolonsBot/proxy.js`)
6. GunDB Server (`/HolonsBot/GunServer.js`)

### Current Notifications
- Telegram messages (HolonsBot)
- Federation announcements
- In-app notifications
- **Missing**: Real-time browser notifications

### Critical Configuration
- `VITE_HOLOSPHERE_PRIVATE_KEY`: Must match between Harvest and HolonsBot
- `enablePing: false`: In Harvest (prevents disconnection issues)
- `5000ms timeout`: In HolonsBot (relay operation timeout)
- Both apps read/write to same Nostr relays

---

## File Locations Quick Reference

| What | Location |
|------|----------|
| Relay Config | `/Users/roberto/Projects/HolonsBot/relay-config.js` |
| Harvest Init | `/Users/roberto/Projects/harvest/src/routes/+layout.svelte` |
| HolonsBot DB | `/Users/roberto/Projects/HolonsBot/DB.js` |
| HoloSphere Core | `/Users/roberto/Projects/holosphere2/src/core/holosphere.js` |
| Nostr Client | `/Users/roberto/Projects/holosphere2/src/storage/nostr-client.js` |
| Notifications | `/Users/roberto/Projects/HolonsBot/Announcements.js` |
| WebSocket Proxy | `/Users/roberto/Projects/HolonsBot/proxy.js` |
| GunServer | `/Users/roberto/Projects/HolonsBot/GunServer.js` |

---

## How to Use These Documents

**For Quick Answers**:
1. Check QUICK_REFERENCE.md first
2. Jump to specific section using Table of Contents
3. Use Ctrl+F to search for keywords

**For Deep Dives**:
1. Start with WEBSOCKET_RELAY_ANALYSIS.md "Executive Summary"
2. Jump to relevant section
3. Follow code references to actual files
4. Check SEARCH_RESULTS_SUMMARY.txt for file paths

**For Troubleshooting**:
1. Check QUICK_REFERENCE.md → "Common Issues & Fixes"
2. Verify configuration in WEBSOCKET_RELAY_ANALYSIS.md → "Section 10"
3. Check file paths in SEARCH_RESULTS_SUMMARY.txt
4. Review relevant source files

**For Implementation**:
1. Read WEBSOCKET_RELAY_ANALYSIS.md → "Section 13: Recommendations"
2. Review QUICK_REFERENCE.md → "Next Steps"
3. Check absolute file paths in SEARCH_RESULTS_SUMMARY.txt
4. Follow code examples in WEBSOCKET_RELAY_ANALYSIS.md

---

## Search Coverage

These documents cover searches for:
- ✅ WebSocket implementation
- ✅ Relay server configuration
- ✅ HolonsBot connection methods
- ✅ Harvest app websocket setup
- ✅ Notification systems
- ✅ Real-time update mechanisms
- ✅ Data synchronization flows
- ✅ Environment configuration
- ✅ Connection architecture
- ✅ GunDB integration
- ✅ HoloSphere library usage
- ✅ Nostr protocol implementation

---

## Last Updated
November 3, 2025

---

## Document Versions

| Document | Type | Sections | Purpose |
|----------|------|----------|---------|
| WEBSOCKET_RELAY_ANALYSIS.md | Technical | 13 | Deep technical reference |
| QUICK_REFERENCE.md | Guide | 14 | Quick lookup & troubleshooting |
| SEARCH_RESULTS_SUMMARY.txt | Report | 12 | Search results & file paths |
| WEBSOCKET_DOCUMENTATION_INDEX.md | Index | - | Navigation guide (this file) |

