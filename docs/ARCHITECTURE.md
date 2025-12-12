==============================================================================

ARCHITECTURE: Nostr-based relay system + GunDB peer-to-peer sync
NOT TRADITIONAL WEBSOCKETS: Uses Nostr protocol with cryptographic signatures

================================================================================
1. RELAY SERVER IMPLEMENTATION
================================================================================

PRIMARY RELAY CONFIGURATION FILE:
  /HolonsBot/relay-config.js
  
RELAY ENDPOINTS:
  - ws://localhost:7777          (Custom local relay, real-time broadcasting)
  - wss://relay.nostr.band       (Public Nostr relay, backup/persistence)

INITIALIZATION IN HARVEST:
  /harvest/src/routes/+layout.svelte
  Lines 21-25:
    relays: [
        'ws://localhost:7777',
        'wss://relay.nostr.band'
    ]

CONFIGURATION FUNCTION:
  export function getRelays(env = 'production')
  Returns array of relay URLs based on environment

ENVIRONMENTS:
  - production: [ws://localhost:7777, wss://relay.nostr.band]
  - development: [ws://localhost:7777, wss://relay.nostr.band]
  - local: [] (no network sync)

================================================================================
2. HOLONSBOT WEBSOCKET & RELAY CONNECTION
================================================================================

MAIN BOT ENTRY POINT:
  /HolonsBot/HolonsBot.js
  - Minimal wrapper, delegates to core/HolonsBotCore.js
  - Includes graceful shutdown handlers (SIGINT/SIGTERM)

DATABASE CLASS (MANAGES RELAY CONNECTIONS):
  /HolonsBot/DB.js
  
  KEY FEATURES:
  - Creates HoloSphere instance with persistent private key
  - Initializes relays via getRelays('production')
  - Default 5000ms timeout for relay operations
  - Write cache with 60-second TTL
  - Preloads data from Nostr relays on init
  
  METHODS:
  - put(table, key, data) → Publishes to Nostr relays
  - get(table, key) → Queries relays with timeout
  - del(table, key) → Deletes from Nostr storage
  - holosphere.getFederation(chatId) → Gets federation config

PERSISTENT KEY STORAGE:
  /HolonsBot/utils/key-storage.js
  Uses: getOrCreateKey(dbName, generatePrivateKey)
  
  IMPORTANCE: Maintains identity across bot restarts, allows
  accessing same data from previous sessions

================================================================================
3. HARVEST APP WEBSOCKET SETUP
================================================================================

MAIN INITIALIZATION FILE:
  /harvest/src/routes/+layout.svelte
  
  KEY CODE (lines 13-26):
  const privateKey = import.meta.env.VITE_HOLOSPHERE_PRIVATE_KEY;
  const holosphere = new HoloSphere({
    appName: environmentName,
    privateKey: privateKey,        // SHARED WITH HOLONSBOT
    relays: ['ws://localhost:7777', 'wss://relay.nostr.band'],
    enablePing: false              // Prevent disconnection issues
  });

CONTEXT DISTRIBUTION:
  setContext('holosphere', holosphere)
  - Shared with all child components
  - Accessed via getContext('holosphere')

MEMORY MANAGEMENT:
  Lines 48-62: Periodic garbage collection hints every 60 seconds
  Lines 43-46: 500ms initialization delay for relay connections

IMPORTANT CONFIGURATION:
  - enablePing: false (designed to prevent connection closure)
  - Private key must match HolonsBot's for data synchronization
  - Environment variables set via VITE_HOLOSPHERE_PRIVATE_KEY

================================================================================
4. WEBSOCKET PROXY & GUNDB SYNC
================================================================================

REVERSE PROXY SERVER:
  /HolonsBot/proxy.js
  
  CONFIGURATION:
  - Listens on port 443 (HTTPS)
  - Routes /gun paths → GunServer (port 8765)
  - Routes other paths → Harvest/Avatar Server (port 3000)
  - Proxies both HTTP and WebSocket connections
  
  WEBSOCKET UPGRADE HANDLING (lines 40-58):
  server.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/gun')) {
      proxy.ws(req, socket, head, {
        target: 'http://localhost:8765',
        ws: true
      });
    }
  });

GUNSERVER IMPLEMENTATION:
  /HolonsBot/GunServer.js
  
  FEATURES:
  - Express-based HTTP/HTTPS server on port 8765
  - Gun.serve middleware for WebSocket handling
  - Local file persistence: gun_data.db
  - Configurable peer network via GUN_PEERS env variable
  
  INITIALIZATION (lines 12-48):
  Creates Gun instance with:
    - web: express server instance
    - file: 'gun_data.db' (local persistence)
    - multicast: false
    - peers: from GUN_PEERS env variable

================================================================================
5. HOLOSPHERE LIBRARY - CORE WEBSOCKET MANAGEMENT
================================================================================

MAIN HOLOSPHERE CLASS:
  /holosphere2/src/core/holosphere.js
  
  CONFIGURATION:
  export class HoloSphere {
    constructor(config = {}) {
      this.config = {
        appName: config.appName || 'holosphere',
        relays: config.relays || ['wss://relay.damus.io', 'wss://relay.nostr.band'],
        privateKey: config.privateKey,
        logLevel: config.logLevel || 'WARN'
      };

NOSTR CLIENT - SIMPLEPOOL MANAGEMENT:
  /holosphere2/src/storage/nostr-client.js
  
  KEY FEATURES:
  - SimplePool from nostr-tools library
  - enableReconnect: true (auto-reconnect on disconnect)
  - enablePing: true (periodic pings to keep alive)
  - Persistent storage for event caching
  - Event signing with privateKey
  
  METHODS:
  - publish(event) → Signs and broadcasts to all relays
  - query(filter) → Queries all relays with timeout
  - subscribe(filter, callback) → Subscribes to events (BUILT-IN)
  
  KEY CODE (lines 138-149):
  async publish(event) {
    const signedEvent = finalizeEvent(event, this.privateKey);
    await this._cacheEvent(signedEvent);
    const results = await Promise.allSettled(
      this.pool.publish(this.relays, signedEvent)
    );
  }

================================================================================
6. NOTIFICATION SYSTEM IMPLEMENTATION
================================================================================

CURRENT NOTIFICATION SYSTEM:
  /HolonsBot/Announcements.js
  
  ANNOUNCEMENT BROADCASTING (lines 61-130):
  - Gets federation info: await db.holosphere.getFederation(chatId)
  - Checks federation.notify list for target holons
  - For each federated holon: sends Telegram message
  - Tracks federation messages for coordination
  
  FEDERATION LENS:
  Uses lensConfig to determine:
    - federate: [] (which lenses to share)
    - notify: [] (which holons to notify)

TELEGRAM NOTIFICATIONS:
  /HolonsBot/Quests.js:
  this.bot.telegram.pinChatMessage(quest.chat, quest.id, {
    disable_notification: true
  });

  /HolonsBot/Holons.js:
  await ctx.reply("🏁 Smart Sync process steps submitted. You will receive notifications for each transaction.");

NOTIFICATION FLOW:
  1. HolonsBot.db.put(chatId + '/announcements', announcement)
  2. HoloSphere signs with privateKey
  3. Publishes to Nostr relays
  4. Relay broadcasts to subscribers
  5. HolonsBot checks federation.notify
  6. Sends Telegram messages to federated chats

================================================================================
7. FILE STRUCTURE & ABSOLUTE PATHS
================================================================================

HARVEST APPLICATION:
  /harvest/
    src/routes/+layout.svelte                  (Main HoloSphere init)
    src/lib/holons/HolonsManager.ts           (Smart contract events)
    src/lib/holons/HolonsContract.ts          (Blockchain interaction)
    src/components/MyHolons.svelte            (Holon selection)
    src/dashboard/TopBar.svelte               (UI with HolonsBot ref)
    src/components/TelegramAuth.svelte        (Telegram login widget)

HOLONSBOT:
  /HolonsBot/
    HolonsBot.js                              (Entry point)
    relay-config.js                           (Relay URLs)
    DB.js                                     (Relay database)
    GunServer.js                              (P2P sync server)
    proxy.js                                  (WebSocket proxy)
    Announcements.js                          (Federation notifications)
    Holons.js                                 (Main bot logic)
    Quests.js                                 (Quest notifications)

HOLOSPHERE LIBRARY:
  /holosphere2/
    src/core/holosphere.js                    (HoloSphere class)
    src/storage/nostr-client.js               (NostrClient/SimplePool)
    src/storage/nostr-wrapper.js              (Storage wrapper)
    src/storage/nostr-async.js                (Async operations)
    src/subscriptions/manager.js              (Subscription handling)

================================================================================
8. ENVIRONMENT VARIABLES & CONFIGURATION
================================================================================

HARVEST (.env or .env.local):
  VITE_HOLOSPHERE_PRIVATE_KEY=<hex_string>    (Must match HolonsBot)
  VITE_LOCAL_MODE=development|production       (Environment flag)

HOLONSBOT (.env):
  NODE_ENV=development|production
  GUN_PORT=8765                               (GunServer port)
  PROXY_PORT=443                              (Reverse proxy port)
  GUN_SERVER_URL=http://localhost:8765
  AVATAR_SERVER_URL=http://localhost:3000
  SSL_KEY_PATH=certs/private.key
  SSL_CERT_PATH=certs/certificate.crt
  GUN_PEERS=<peer_urls>                       (Optional: other peers)

RELAY TIMEOUTS:
  - HolonsBot: 5000ms (5 seconds) for relay operations
  - Harvest: enablePing: false (designed feature)
  - SimplePool: Default connection timeout

================================================================================
9. DATA SYNCHRONIZATION FLOW
================================================================================

WRITE OPERATION:
  1. Component: db.put('table/key', data)
  2. DB class: Cache write, then publish
  3. HoloSphere: Sign event with privateKey
  4. NostrClient: Publish to all relays
  5. Relay: Validate signature, broadcast to subscribers
  6. Other nodes: Receive, verify, cache

READ OPERATION:
  1. Component: db.get('table/key')
  2. DB class: Check 60-second write cache
  3. If miss: Query relays with 5s timeout
  4. NostrClient: Query all relays via SimplePool
  5. Relay: Return most recent events
  6. Return: Cache and return most recent version

REAL-TIME (NOT YET IMPLEMENTED):
  1. Relay broadcasts new event
  2. SimplePool receives via subscription
  3. HoloSphere emits event (built-in capability)
  4. Components should listen for events
  5. UI updates with new data

================================================================================
10. CURRENT LIMITATIONS & GAPS
================================================================================

NO REAL-TIME WEBSOCKET NOTIFICATIONS:
  - Harvest doesn't subscribe to Nostr relay events
  - No client-side event listeners
  - No polling for updates
  - No browser push notifications
  - Only Telegram notifications via HolonsBot

WORKAROUNDS CURRENTLY IN USE:
  - Telegram messages (HolonsBot)
  - In-app announcements (federation system)
  - Manual page refresh
  - Smart Sync transaction status (Telegram)

TO IMPLEMENT REAL-TIME NOTIFICATIONS:
  1. Subscribe to relay events: holosphere.client.subscribe()
  2. Dispatch events to components
  3. Add browser notification API
  4. Implement heartbeat/keep-alive
  5. Handle reconnection gracefully

================================================================================
11. QUICK REFERENCE TABLE
================================================================================

File                              Path                                           Purpose
─────────────────────────────────────────────────────────────────────────────────────
relay-config.js                   /HolonsBot/                                    Relay URLs
DB.js                             /HolonsBot/                                    Database+relays
GunServer.js                       /HolonsBot/                                    P2P sync
proxy.js                           /HolonsBot/                                    WebSocket proxy
Announcements.js                   /HolonsBot/                                    Notifications
+layout.svelte                     /harvest/src/routes/                          App init
HolonsManager.ts                   /harvest/src/lib/holons/                      Smart contracts
holosphere.js                      /holosphere2/src/core/                        Main library
nostr-client.js                    /holosphere2/src/storage/                     SimplePool

================================================================================
12. CONNECTION ARCHITECTURE SUMMARY
================================================================================

Layer 1 - Relay Network:
  ws://localhost:7777 (Custom relay)
  wss://relay.nostr.band (Public backup)
  Connected via SimplePool with auto-reconnect

Layer 2 - Applications:
  Harvest (Port 3000): Uses HoloSphere to read/write
  HolonsBot: Uses DB class (wraps HoloSphere)
  Both share same private key for data access

Layer 3 - P2P Sync:
  GunServer (Port 8765): Provides peer-to-peer sync
  Reverse Proxy (Port 443): Routes traffic
  WebSocket upgrade handling for both services

Layer 4 - Notifications:
  Telegram: HolonsBot sends messages via federation
  In-app: Announcements via Nostr events
  (Browser notifications not yet implemented)

================================================================================
DOCUMENTATION CREATED
================================================================================

1. /harvest/WEBSOCKET_RELAY_ANALYSIS.md
   - Comprehensive technical documentation
   - 13 sections covering all aspects
   - Code examples and diagrams
   - Recommendations for improvements

2. /harvest/QUICK_REFERENCE.md
   - Quick lookup guide
   - Common issues and fixes
   - Useful commands
   - Architecture diagrams

================================================================================
