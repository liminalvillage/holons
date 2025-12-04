# WebSocket & Relay Quick Reference Guide

## Key Files at a Glance

### Harvest Application (SvelteKit)
- **`/Users/roberto/Projects/harvest/src/routes/+layout.svelte`** - HoloSphere initialization with relay config
- **`/Users/roberto/Projects/harvest/src/lib/holons/HolonsManager.ts`** - Smart contract event management
- **`/Users/roberto/Projects/harvest/src/lib/holons/HolonsContract.ts`** - Blockchain interaction

### HolonsBot (Node.js Telegram Bot)
- **`/Users/roberto/Projects/HolonsBot/relay-config.js`** - Relay server URLs (ws://localhost:7777, wss://relay.nostr.band)
- **`/Users/roberto/Projects/HolonsBot/DB.js`** - Database + Nostr relay interface
- **`/Users/roberto/Projects/HolonsBot/GunServer.js`** - P2P data sync server (port 8765)
- **`/Users/roberto/Projects/HolonsBot/proxy.js`** - WebSocket reverse proxy (port 443)
- **`/Users/roberto/Projects/HolonsBot/Announcements.js`** - Federation-based notifications

### HoloSphere Library
- **`/Users/roberto/Projects/holosphere2/src/core/holosphere.js`** - Main class managing Nostr relays
- **`/Users/roberto/Projects/holosphere2/src/storage/nostr-client.js`** - SimplePool relay management

---

## Relay Configuration

### Production Relays
```javascript
'ws://localhost:7777'        // Custom relay, real-time broadcasting
'wss://relay.nostr.band'     // Public backup, persistence
```

### How to Access
```javascript
// In HolonsBot
import { getRelays } from './relay-config.js';
const relays = getRelays('production'); // ['ws://localhost:7777', 'wss://relay.nostr.band']

// In Harvest (via environment variable)
const holosphere = new HoloSphere({
  relays: ['ws://localhost:7777', 'wss://relay.nostr.band']
});
```

---

## Data Flow Summary

### Write Operation
```
Component calls db.put('table/key', data)
  ↓
HoloSphere signs event with privateKey
  ↓
NostrClient publishes to all relays
  ↓
Relay broadcasts to subscribers
  ↓
Other nodes receive and cache
```

### Read Operation
```
Component calls db.get('table/key')
  ↓
Check local cache first
  ↓
Query Nostr relays via SimplePool (5s timeout)
  ↓
Return most recent event
  ↓
Cache result for 60 seconds
```

### Real-Time Notifications (NOT YET IMPLEMENTED)
```
Relay broadcasts new event
  ↓
Should trigger HoloSphere subscription callback
  ↓
Should dispatch event to components
  ↓
Should show browser notification
```

---

## Critical Configuration Variables

### Environment
```bash
# Harvest (.env or .env.local)
VITE_HOLOSPHERE_PRIVATE_KEY=<hex_32_byte_key>  # Must match HolonsBot's key
VITE_LOCAL_MODE=development|production

# HolonsBot (.env)
NODE_ENV=development|production
GUN_PORT=8765
PROXY_PORT=443
GUN_SERVER_URL=http://localhost:8765
AVATAR_SERVER_URL=http://localhost:3000
```

### Relay Behavior
- **5000ms timeout**: HolonsBot waits max 5 seconds for relay responses
- **enablePing: false**: Harvest disables periodic pings to prevent connection issues
- **enableReconnect: true**: Auto-reconnect on disconnect
- **Fallback strategy**: Primary relay → backup relay on failure

---

## Common Issues & Fixes

### Local Relay Not Running?
```bash
# The custom relay at ws://localhost:7777 must be running separately
# If unavailable, system falls back to wss://relay.nostr.band
# Check: Is the relay server process running?
```

### Data Not Syncing Between Harvest & HolonsBot?
```bash
# Verify both use same private key:
# Harvest: VITE_HOLOSPHERE_PRIVATE_KEY (env variable)
# HolonsBot: Stored in persistent key-storage, derived from dbName

# Verify both connect to same relays
# Verify relay is broadcasting events (check logs)
```

### WebSocket Connection Dropped?
```bash
# enablePing: false in Harvest - designed to prevent disconnections
# If happening in HolonsBot, check:
# - Relay server status
# - Network connectivity
# - 5000ms timeout might need increase for slow relays
```

---

## WebSocket Connection Ports

| Service | Port | Protocol | Purpose |
|---------|------|----------|---------|
| Harvest App | 3000 | HTTP(S) | Main SvelteKit app |
| GunServer | 8765 | HTTP(S) + WebSocket | P2P data sync |
| Reverse Proxy | 443 | HTTPS + WebSocket | Routes /gun to 8765, others to 3000 |
| Local Relay | 7777 | WebSocket | Nostr relay (custom) |
| Public Relay | N/A | HTTPS + WebSocket | wss://relay.nostr.band |

---

## Event Flow Architecture

### Harvest Components
```typescript
// Access HoloSphere via context
const holosphere = getContext('holosphere');

// Read data (queries relays)
const data = await holosphere.get('table', 'key');

// Write data (publishes to relays)
await holosphere.put('table', 'key', data);

// Subscribe to updates (NOT YET IMPLEMENTED)
// holosphere.subscribe(filters, callback);
```

### HolonsBot Database
```javascript
// DB class wraps HoloSphere
const db = new DB('bot_name');
await db.init();  // Preload from relays

// Read
const data = await db.get('table', 'key');

// Write
await db.put('table', 'key', data);

// Delete
await db.del('table', 'key');

// Access underlying HoloSphere
const federation = await db.holosphere.getFederation(holonId);
```

---

## Notification System (Current)

### Announcement Broadcasting
```javascript
// In Announcements.js
await db.put(chatId + '/announcements', announcement);

// HolonsBot retrieves federation config
const fedInfo = await db.holosphere.getFederation(chatId);

// Sends Telegram messages to federation.notify holons
for (const federatedChatId of fedInfo.notify) {
  await bot.telegram.sendMessage(federatedChatId, message);
}
```

### Transaction Notifications
```javascript
// Smart Sync sends Telegram messages
await ctx.reply("🏁 Smart Sync process steps submitted. You will receive notifications for each transaction.");
```

---

## Next Steps for Real-Time Notifications

To add browser notifications to Harvest:

1. **Subscribe to Relay Events**
   - Use `holosphere.client.subscribe()` for real-time updates
   - Filter for announcement events

2. **Dispatch Events in Components**
   - Use Svelte stores or custom events
   - Trigger on relay broadcast

3. **Show Notifications**
   - Browser Notification API
   - Toast notifications
   - In-app message center

4. **Keep WebSocket Alive**
   - Implement heartbeat mechanism
   - Handle reconnection gracefully

---

## Useful Commands

```bash
# Test relay connectivity
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  http://localhost:7777

# Check HolonsBot DB status
npm run test-db-sync  # In HolonsBot directory

# Monitor relay logs
tail -f /path/to/relay/logs

# Check if GunServer is running
lsof -i :8765

# Check if relay is accessible
nc -zv localhost 7777
```

---

## Architecture Diagram (Text)

```
┌─────────────────────────────────────────┐
│ Harvest (SvelteKit + HoloSphere)        │
│ env: VITE_HOLOSPHERE_PRIVATE_KEY        │
└────────────────┬────────────────────────┘
                 │
         ┌───────┴────────┐
         │                │
    ┌────▼────────┐  ┌───▼──────────────┐
    │ Relay 1     │  │ Relay 2          │
    │ localhost:  │  │ relay.nostr.band │
    │ 7777 (WS)   │  │ (WSS)            │
    └────┬────────┘  └────┬─────────────┘
         │                │
         └────────┬───────┘
                  │
         ┌────────▼──────────┐
         │ Shared Nostr Data │
         │ (Events Store)    │
         └────────┬──────────┘
                  │
         ┌────────▼──────────┐
         │ GunServer         │
         │ localhost:8765    │
         │ (P2P Sync)        │
         └────────┬──────────┘
                  │
         ┌────────▼──────────┐
         │ HolonsBot         │
         │ (Telegram)        │
         │ DB class reads/   │
         │ writes to relays  │
         └───────────────────┘
```

