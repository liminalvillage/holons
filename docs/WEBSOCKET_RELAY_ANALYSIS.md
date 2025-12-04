# WebSocket, Relay, and Notification System Analysis

## Executive Summary

The Harvest application and HolonsBot ecosystem use a **Nostr-based relay architecture** with GunDB for peer-to-peer communication. Instead of traditional WebSockets for direct app-to-server communication, the system leverages:

1. **Nostr Protocol**: Open event-based messaging protocol using cryptographic signatures
2. **SimplePool Relay Management**: Connects to multiple relays (ws://localhost:7777 and wss://relay.nostr.band)
3. **GunDB**: Peer-to-peer database that syncs via WebSockets
4. **HoloSphere**: Unified interface combining Nostr relays with GunDB storage

---

## Architecture Overview

### 1. RELAY SERVER INFRASTRUCTURE

#### Primary Relay URLs
- **Local Relay**: `ws://localhost:7777` - Custom relay with real-time broadcasting
- **Backup Relay**: `wss://relay.nostr.band` - Public Nostr relay for persistence

#### Location: `/Users/roberto/Projects/HolonsBot/relay-config.js`
```javascript
export const RELAY_CONFIG = {
  production: [
    'ws://localhost:7777',        // Custom relay with real-time broadcasting
    'wss://relay.nostr.band',     // Backup for persistence
  ],
  development: [
    'ws://localhost:7777',
    'wss://relay.nostr.band',
  ],
  local: [], // No network sync for offline testing
};
```

**Key Configuration**:
- Two-tier relay strategy: Primary local relay for speed, backup public relay for persistence
- Configuration by environment (production, development, local)
- Relays accessed via `getRelays(environment)` function

---

## 2. HARVEST APP WEBSOCKET SETUP

### File: `/Users/roberto/Projects/harvest/src/routes/+layout.svelte`

The main Harvest application initializes HoloSphere with relay configuration:

```typescript
const privateKey = import.meta.env.VITE_HOLOSPHERE_PRIVATE_KEY;

const holosphere = new HoloSphere({
    appName: environmentName,  // 'HolonsDebug' or 'Holons'
    privateKey: privateKey,    // Shared with HolonsBot
    relays: [
        'ws://localhost:7777',       // Custom relay with real-time broadcasting
        'wss://relay.nostr.band'     // Backup for persistence
    ],
    enablePing: false  // Disable ping to prevent connection closure issues
});
```

### Key Features:
- **Shared Private Key**: Harvest and HolonsBot use the same private key for data access
- **Context-Based Distribution**: HoloSphere instance shared via `setContext('holosphere', holosphere)`
- **Memory Management**: Periodic garbage collection hints (every 60 seconds)
- **Connection Ready Check**: 500ms initialization delay for relay connections

---

## 3. HOLONSBOT WEBSOCKET & RELAY INTEGRATION

### File: `/Users/roberto/Projects/HolonsBot/DB.js`

HolonsBot uses a persistent database class that manages all Nostr relay connections:

```javascript
class DB {
    constructor(dbName) {
        // Persistent private key - maintains identity across restarts
        const privateKey = getOrCreateKey(dbName, generatePrivateKey);
        
        this.holosphere = new HoloSphere({
            appName: dbName,
            privateKey: privateKey,  // PERSISTENT
            logLevel: 'WARN',
            relays: getRelays('production')  // Uses relay-config.js
        });
        
        this.defaultTimeout = 5000;  // 5 second timeout for Nostr operations
        this.writeCache = new Map();  // Cache for performance
        this.writeCacheTTL = 60000;   // 60 second TTL
    }

    async init() {
        console.log(`DB "${this.dbName}" initialized with ${this.holosphere.config.relays.length} Nostr relays`);
        this.preloadCache();  // Background preload from Nostr
    }
}
```

### Key Functions:
- `put(table, key, data)` - Publish to Nostr relays
- `get(table, key)` - Query relays with 5s timeout
- `del(table, key)` - Delete from Nostr storage
- **Persistent Key Storage**: Keys stored via `getOrCreateKey()` for identity persistence

---

## 4. GUNDB WEBSOCKET PROXY

### File: `/Users/roberto/Projects/HolonsBot/proxy.js`

Handles WebSocket upgrades for both GunDB and main application:

```javascript
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/gun')) {
    // Proxy WebSocket to GunServer (port 8765)
    proxy.ws(req, socket, head, { 
      target: 'http://localhost:8765',
      ws: true,
      changeOrigin: true 
    });
  } else {
    // Proxy WebSocket to main app (port 3000)
    proxy.ws(req, socket, head, { 
      target: 'http://localhost:3000',
      ws: true,
      changeOrigin: true 
    });
  }
});
```

### Architecture:
- **Reverse Proxy Pattern**: Central proxy at port 443 (HTTPS)
- **GunDB Routing**: `/gun` paths to port 8765 (GunServer)
- **Application Routing**: Other paths to port 3000 (Harvest)
- **WebSocket Upgrade Handling**: Full bidirectional upgrade support

---

## 5. GUNSERVER IMPLEMENTATION

### File: `/Users/roberto/Projects/HolonsBot/GunServer.js`

Simple GunDB server providing peer-to-peer data sync:

```javascript
class GunServer {
  setupServer() {
    const app = express();
    const port = process.env.GUN_PORT || 8765;
    
    app.use(express.static('public'));
    app.use(Gun.serve);  // GunDB WebSocket handler
    
    this.gun = Gun({
      axe: false,
      web: this.serverInstance,
      file: 'gun_data.db',    // Local persistence
      multicast: false,
      localStorage: false,
      peers: process.env.GUN_PEERS ? 
             process.env.GUN_PEERS.split(',') : []
    });
  }
}
```

**Features**:
- Express-based HTTP/HTTPS server
- GunDB middleware for WebSocket handling
- Local file persistence (`gun_data.db`)
- Configurable peer network

---

## 6. HOLOSPHERE LIBRARY - NOSTR CLIENT CORE

### File: `/Users/roberto/Projects/holosphere2/src/core/holosphere.js`

Main library managing Nostr relay connections:

```javascript
export class HoloSphere {
  constructor(config = {}) {
    this.config = {
      appName: config.appName || 'holosphere',
      relays: config.relays || ['wss://relay.damus.io', 'wss://relay.nostr.band'],
      privateKey: config.privateKey,
      logLevel: config.logLevel || 'WARN',
    };

    // Initialize Nostr client
    this.client = createClient({
      relays: this.config.relays,
      privateKey: this.config.privateKey,
      enableReconnect: config.enableReconnect !== false,
      enablePing: config.enablePing !== false,
      appName: this.config.appName,
      persistence: config.persistence !== false,
    });
  }
}
```

### File: `/Users/roberto/Projects/holosphere2/src/storage/nostr-client.js`

Manages SimplePool relay connections:

```javascript
export class NostrClient {
  constructor(config = {}) {
    this.relays = config.relays || [];
    this.privateKey = config.privateKey || this._generatePrivateKey();
    this.publicKey = getPublicKey(this.privateKey);
    
    // Initialize SimplePool with auto-reconnect and ping
    this.pool = new SimplePool({
      enableReconnect: config.enableReconnect !== false,
      enablePing: config.enablePing !== false,
    });

    // Persistent storage for caching events
    this._storageReady = this._initPersistentStorage();
  }

  async publish(event) {
    const signedEvent = finalizeEvent(event, this.privateKey);
    await this._cacheEvent(signedEvent);
    
    // Publish to all relays
    const results = await Promise.allSettled(
      this.pool.publish(this.relays, signedEvent)
    );
    return results;
  }

  async query(filter) {
    // Query all relays with fallback behavior
    const events = await this.pool.querySync(
      this.relays, 
      filter, 
      options
    );
    return events;
  }
}
```

**SimplePool Features**:
- Auto-reconnect on disconnect
- Periodic ping to keep connections alive
- Fallback relay switching
- Event signing and verification

---

## 7. HOLONSBOT NOTIFICATION SYSTEM

### File: `/Users/roberto/Projects/HolonsBot/Announcements.js`

Implements federated announcements with notification routing:

```javascript
async handleFederatedAnnouncements(ctx, announcement, language) {
  // Get federation info to find which holon to notify
  const fedInfo = await this.db.holosphere.getFederation(announcement.chat);
  
  if (!fedInfo?.notify?.length) {
    return;  // No federated chats to notify
  }

  // For each federated holon in notify list
  for (const federatedChatId of fedInfo.notify) {
    if (federatedChatId === announcement.chat) {
      continue;  // Skip same chat
    }

    // Check target holon allows announcements lens
    const targetFedInfo = await this.db.holosphere.getFederation(federatedChatId);
    
    // Send formatted announcement to federated holon
    await this.bot.telegram.sendMessage(federatedChatId, formattedMessage);
  }
}
```

### Notification Patterns:
- **Announcement Broadcasting**: Via federation lens system
- **Smart Sync Notifications**: Transaction status updates
- **Check Pinning**: Disable notifications for certain actions

```javascript
// From Holons.js
await ctx.reply("🏁 Smart Sync process steps submitted. You will receive notifications for each transaction.");

// From Quests.js
this.bot.telegram.pinChatMessage(quest.chat, quest.id, { 
  disable_notification: true 
});
```

---

## 8. DATA FLOW: RELAY ↔ HARVEST ↔ HOLONSBOT

### Initialization Sequence:
```
1. HolonsBot starts → DB class initializes HoloSphere with persistent key
2. DB.init() → Preloads cache from Nostr relays
3. Harvest loads → +layout.svelte creates HoloSphere with shared key
4. Relay connections establish → ws://localhost:7777 (primary)
5. Fallback to wss://relay.nostr.band if primary fails
```

### Real-Time Update Flow:
```
HolonsBot writes to Nostr relay
    ↓
Relay broadcasts to all subscribers
    ↓
Harvest receives via pool.subscribeMany()
    ↓
Components notified via HoloSphere events
    ↓
UI re-renders with new data
```

### Notification Delivery:
```
Holonsbot.db.put(chatId + '/announcements', announcement)
    ↓
HoloSphere signs event with privateKey
    ↓
Nostr relay validates and stores
    ↓
Relay broadcasts to all federated holons
    ↓
HolonsBot checks federation.notify list
    ↓
Sends Telegram message to federated chats
```

---

## 9. KEY FILES SUMMARY TABLE

| File | Location | Purpose | Key Exports |
|------|----------|---------|-------------|
| relay-config.js | HolonsBot root | Relay configuration | getRelays(env) |
| DB.js | HolonsBot root | Database abstraction | DB class |
| GunServer.js | HolonsBot root | P2P sync server | GunServer class |
| proxy.js | HolonsBot root | WebSocket proxy | HTTP reverse proxy |
| +layout.svelte | harvest/src/routes | App initialization | HoloSphere instance context |
| HolonsManager.ts | harvest/src/lib/holons | Smart contract interface | HolonsManager class |
| HolonsContract.ts | harvest/src/lib/holons | Contract interaction | HolonsContract class |
| holosphere.js | holosphere2/src/core | Nostr client core | HoloSphere class |
| nostr-client.js | holosphere2/src/storage | Relay pool management | NostrClient class |
| Announcements.js | HolonsBot root | Federation announcements | Announcements class |

---

## 10. CRITICAL CONFIGURATION DETAILS

### Environment Variables Required:
```bash
# Harvest app
VITE_HOLOSPHERE_PRIVATE_KEY=<hex_string>    # Shared with HolonsBot
VITE_LOCAL_MODE=development|production

# HolonsBot
NODE_ENV=development|production
GUN_PORT=8765
SSL_KEY_PATH=certs/private.key              # For HTTPS
SSL_CERT_PATH=certs/certificate.crt        # For HTTPS
PROXY_PORT=443                               # For reverse proxy
AVATAR_SERVER_URL=http://localhost:3000     # Main Harvest app
GUN_SERVER_URL=http://localhost:8765        # GunDB server
```

### Relay Configuration:
- **ws://localhost:7777**: Custom Nostr relay with real-time broadcasting
- **wss://relay.nostr.band**: Public Nostr relay for backup/persistence
- **5000ms default timeout**: For Nostr relay operations in HolonsBot
- **enablePing: false**: Disabled in Harvest to prevent connection issues

---

## 11. WEBSOCKET CONNECTION FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────┐
│ Client Browser (Harvest SvelteKit App)              │
│ +layout.svelte creates HoloSphere instance          │
│ Private Key: VITE_HOLOSPHERE_PRIVATE_KEY            │
└────────────────────────────────────────────────────┬┘
                                                       │
                        ┌──────────────────────────────┤
                        ▼                              ▼
        ┌───────────────────────────┐    ┌───────────────────────────┐
        │ Reverse Proxy             │    │ GunServer (port 8765)     │
        │ (proxy.js, port 443)      │    │ Gun.serve middleware      │
        │                           │    │ WebSocket for sync        │
        └─────────┬─────────────────┘    └────────────────┬──────────┘
                  │                                       │
        Routes /gun to                          P2P Data Sync
        GunServer WebSocket                     localStorage: gun_data.db
        Routes others to Harvest                peers via WebSocket
        (port 3000)
                  │
        ┌─────────┴──────────────────┐
        ▼                            ▼
  ┌──────────────────────┐  ┌──────────────────────┐
  │ Harvest App          │  │ HolonsBot Process    │
  │ (port 3000)          │  │ (Telegram bot)       │
  │ Uses HoloSphere      │  │ DB class initializes │
  │ for Nostr access     │  │ HoloSphere with      │
  │                      │  │ persistent key       │
  └──────────┬───────────┘  └──────────┬───────────┘
             │                         │
             └─────────────┬───────────┘
                          ▼
        ┌──────────────────────────────────┐
        │ Nostr Relay Network              │
        │ ws://localhost:7777 (primary)    │
        │ + wss://relay.nostr.band (backup)│
        │                                  │
        │ SimplePool manages connections   │
        │ Auto-reconnect on failure        │
        │ Cryptographic event signing      │
        └──────────────────────────────────┘
```

---

## 12. CURRENT NOTIFICATION SYSTEM LIMITATIONS

**No Direct WebSocket Notifications Currently Implemented**:
1. Harvest doesn't subscribe to real-time Nostr events
2. No client-side event listener for relay updates
3. Notifications only via Telegram bot in HolonsBot
4. No browser push notifications
5. No polling mechanism for updates

**Existing Notification Methods**:
- Telegram messages (via HolonsBot)
- In-app announcements via federation system
- Smart Sync transaction status updates
- Message pinning in chats

---

## 13. RECOMMENDATIONS FOR WEBSOCKET NOTIFICATIONS

To implement real-time notifications in Harvest:

1. **Subscribe to Relay Events** in HoloSphere:
   ```javascript
   this.client.subscribe(relays, filters, (event) => {
     // Handle new event
     dispatch('notification', event);
   });
   ```

2. **Add Event Listener in Components**:
   ```svelte
   onMount(() => {
     holosphere.on('new-announcement', (data) => {
       showNotification(data);
     });
   });
   ```

3. **Implement Browser Notifications**:
   ```javascript
   new Notification("Holon Update", { body: message });
   ```

4. **Add WebSocket Heartbeat** in proxy.js:
   ```javascript
   server.on('upgrade', (req, socket, head) => {
     socket.on('message', () => {
       socket.ping();  // Keep-alive
     });
   });
   ```

---

## Summary

The Harvest + HolonsBot ecosystem uses a **sophisticated Nostr-relay based architecture** instead of traditional WebSocket servers. The system provides:

- **Distributed relay network** with automatic failover
- **Persistent identity** via cryptographic keys
- **P2P synchronization** via GunDB
- **Federation system** for cross-holon communication
- **Telegram integration** for notifications

To implement real-time web notifications, the next steps would involve subscribing to Nostr relay events in the Harvest app and dispatching them to components.

