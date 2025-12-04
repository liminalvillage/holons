# HoloSphere WebSocket Architecture

## ✅ Correct Implementation

The real-time notification system is implemented **correctly** using `holosphere.client.subscribe()`.

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│              Harvest (Browser)                  │
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │  RealtimeNotifications.svelte            │  │
│  │                                          │  │
│  │  holosphere.client.subscribe({          │  │
│  │    kinds: [30000, 30001],               │  │
│  │    since: timestamp                      │  │
│  │  }, (event) => {                        │  │
│  │    // Handle real-time event            │  │
│  │  })                                     │  │
│  └──────────────┬───────────────────────────┘  │
│                 │                               │
│                 │ Uses HoloSphere client        │
│                 │                               │
│  ┌──────────────▼───────────────────────────┐  │
│  │      HoloSphere Instance                 │  │
│  │                                          │  │
│  │  Created in +layout.svelte:              │  │
│  │  const holosphere = new HoloSphere({    │  │
│  │    appName: 'Holons',                   │  │
│  │    privateKey: env.PRIVATE_KEY,         │  │
│  │    relays: [                            │  │
│  │      'ws://localhost:7777',             │  │
│  │      'wss://relay.nostr.band'           │  │
│  │    ]                                    │  │
│  │  })                                     │  │
│  │                                          │  │
│  │  this.client = NostrClient              │  │
│  └──────────────┬───────────────────────────┘  │
│                 │                               │
└─────────────────┼───────────────────────────────┘
                  │
                  │ WebSocket Connection
                  │ (Nostr Protocol)
                  │
         ┌────────▼────────┐
         │  Nostr Relay    │
         │  :7777          │
         │                 │
         │  - Receives     │
         │    subscriptions│
         │  - Broadcasts   │
         │    events       │
         │  - Stores in    │
         │    SQLite       │
         └────────▲────────┘
                  │
                  │ WebSocket Connection
                  │ (Nostr Protocol)
                  │
┌─────────────────┼───────────────────────────────┐
│                 │                               │
│  ┌──────────────┴───────────────────────────┐  │
│  │      HoloSphere Instance                 │  │
│  │                                          │  │
│  │  const db = new DB('Holons')            │  │
│  │  this.holosphere = new HoloSphere({     │  │
│  │    appName: 'Holons',                   │  │
│  │    privateKey: persistentKey,           │  │
│  │    relays: [                            │  │
│  │      'ws://localhost:7777',             │  │
│  │      'wss://relay.nostr.band'           │  │
│  │    ]                                    │  │
│  │  })                                     │  │
│  │                                          │  │
│  │  this.client = NostrClient              │  │
│  └──────────────┬───────────────────────────┘  │
│                 │                               │
│                 │ Uses HoloSphere client        │
│                 │                               │
│  ┌──────────────▼───────────────────────────┐  │
│  │  Announcements.js                        │  │
│  │                                          │  │
│  │  this.db.holosphere.client.publish({    │  │
│  │    kind: 30000,                         │  │
│  │    content: JSON.stringify(event),      │  │
│  │    tags: [...]                          │  │
│  │  })                                     │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│              HolonsBot (Node.js)                │
└─────────────────────────────────────────────────┘
```

## How It Works

### 1. HoloSphere Initialization

Both Harvest and HolonsBot initialize HoloSphere with the same configuration:

**Harvest (`src/routes/+layout.svelte`):**
```javascript
const holosphere = new HoloSphere({
  appName: 'Holons',
  privateKey: import.meta.env.VITE_HOLOSPHERE_PRIVATE_KEY,
  relays: [
    'ws://localhost:7777',
    'wss://relay.nostr.band'
  ]
});
```

**HolonsBot (`DB.js`):**
```javascript
this.holosphere = new HoloSphere({
  appName: 'Holons',
  privateKey: getOrCreateKey('Holons'),
  relays: [
    'ws://localhost:7777',
    'wss://relay.nostr.band'
  ]
});
```

### 2. HoloSphere Creates Nostr Client

Internally, HoloSphere creates a NostrClient:

**holosphere2/src/core/holosphere.js:**
```javascript
export class HoloSphere {
  constructor(config) {
    this.client = createClient({
      relays: config.relays,
      privateKey: config.privateKey,
      enableReconnect: true,
      enablePing: true,
      appName: config.appName
    });
  }
}
```

### 3. NostrClient Manages WebSocket Connections

**holosphere2/src/storage/nostr-client.js:**
```javascript
export class NostrClient {
  constructor(config) {
    this.relays = config.relays;
    this.pool = new SimplePool({  // From nostr-tools
      enableReconnect: true,
      enablePing: true
    });
  }

  subscribe(filter, onEvent, options) {
    // Uses SimplePool.subscribeMany() which creates WebSocket connections
    const sub = this.pool.subscribeMany(
      this.relays,  // Opens WebSocket to each relay
      [filter],
      {
        onevent: (event) => {
          this._cacheEvent(event);
          onEvent(event);  // Callback to your code
        },
        oneose: () => {
          if (options.onEOSE) options.onEOSE();
        }
      }
    );
    return { unsubscribe: () => sub.close() };
  }

  publish(event) {
    // Publishes to all relays via WebSocket
    const publishPromises = this.pool.publish(this.relays, event);
    return Promise.all(publishPromises);
  }
}
```

## The Flow

### Publishing (HolonsBot → Relay)

1. **User sends `/announce Hello` in Telegram**
2. **Announcements.js** calls:
   ```javascript
   await this.db.holosphere.client.publish({
     kind: 30000,
     content: JSON.stringify({ type: 'announcement', ... })
   });
   ```
3. **NostrClient.publish()** sends event via WebSocket to relay
4. **Relay receives** event and validates signature
5. **Relay broadcasts** to all subscribers

### Subscribing (Relay → Harvest)

1. **RealtimeNotifications.svelte** calls:
   ```javascript
   holosphere.client.subscribe(
     { kinds: [30000] },
     (event) => { addNotification(...) }
   );
   ```
2. **NostrClient.subscribe()** opens WebSocket connection to relay
3. **Relay sends** existing events matching filter (EOSE)
4. **Relay broadcasts** new events as they arrive
5. **Callback fires** with event data
6. **addNotification()** adds to store
7. **Toast appears** in UI

## Why This is Correct

### ✅ Uses HoloSphere's Native API

```javascript
// CORRECT - Uses holosphere.client.subscribe()
holosphere.client.subscribe({ kinds: [30000] }, (event) => {
  console.log('Received:', event);
});
```

### ✅ Maintains WebSocket Connection

The NostrClient's `SimplePool` maintains persistent WebSocket connections to all configured relays. This ensures:
- Real-time event delivery
- Automatic reconnection on disconnect
- Connection pooling for efficiency

### ✅ Follows Nostr Protocol

The subscription uses standard Nostr protocol:
- `REQ` message to relay with subscription ID and filters
- Relay sends matching events
- Relay sends `EOSE` (End of Stored Events)
- Relay continues sending new matching events
- `CLOSE` message when unsubscribing

### ✅ Shared Infrastructure

Both Harvest and HolonsBot use the same:
- HoloSphere library
- Relay configuration
- Private key (same identity)
- Event format (kind 30000 for announcements)

## WebSocket Protocol Details

### Connection Establishment

```
Client                          Relay
  │                               │
  ├─────── WebSocket Handshake ──>│
  │<────── Connection Accept ──────┤
  │                               │
```

### Subscription

```
Client                          Relay
  │                               │
  ├─── ["REQ", "sub:1", filter] ─>│
  │<── ["EVENT", "sub:1", event1]─┤
  │<── ["EVENT", "sub:1", event2]─┤
  │<────── ["EOSE", "sub:1"] ──────┤
  │                               │
  │   (Relay keeps connection open)
  │                               │
  │<── ["EVENT", "sub:1", event3]─┤  (New event arrives)
  │                               │
```

### Publishing

```
Client                          Relay
  │                               │
  ├────── ["EVENT", {...}] ──────>│
  │<── ["OK", eventId, true, ""]──┤
  │                               │
```

## Configuration Files

### Shared Relay Configuration

**holosphere2/relay-config.js:**
```javascript
export const RELAY_CONFIG = {
  production: [
    'ws://localhost:7777',      // Custom relay (real-time)
    'wss://relay.nostr.band'    // Backup relay (persistence)
  ]
};
```

**HolonsBot/relay-config.js:**
```javascript
export const RELAY_CONFIG = {
  production: [
    'ws://localhost:7777',
    'wss://relay.nostr.band'
  ]
};
```

**Harvest/.env:**
```
VITE_HOLOSPHERE_PRIVATE_KEY=your_private_key_here
```

## Verification

You can verify the WebSocket connection in the browser:

1. Open Harvest in browser
2. Open DevTools → Network tab
3. Filter by "WS" (WebSocket)
4. You should see connections to:
   - `ws://localhost:7777`
   - `wss://relay.nostr.band`
5. Click on connection to see messages:
   - `["REQ", "sub:1", {...}]` - Subscription request
   - `["EVENT", "sub:1", {...}]` - Events received
   - `["EOSE", "sub:1"]` - End of stored events

## Console Logs

When working correctly, you'll see:

**Harvest console:**
```
[RealtimeNotifications] Subscribing to announcements via HoloSphere...
[RealtimeNotifications] Connected to relays: ['ws://localhost:7777', 'wss://relay.nostr.band']
[RealtimeNotifications] Subscription established (EOSE received)
[RealtimeNotifications] Now listening for real-time events via WebSocket
[RealtimeNotifications] Received real-time event via WebSocket: 30000 abc123...
[Notifications] New notification: {...}
```

**Relay logs:**
```
[Relay] New client connected
[Relay] REQ subscription: sub:1 filters: 1
[Relay] Sending 0 stored events for subscription: sub:1
[Relay] Received EVENT: { kind: 30000, id: 'abc123...' }
[Relay] Event stored and broadcast. Total events: 1
[Relay] Event broadcast to 1 subscriptions
```

## Summary

✅ **The implementation is correct!**

- Uses `holosphere.client.subscribe()` - the proper HoloSphere API
- Creates WebSocket connections to Nostr relays
- Follows Nostr protocol for subscriptions and events
- Maintains persistent connections for real-time updates
- Shares infrastructure between Harvest and HolonsBot
- Events flow through the relay in real-time

**There is no other/better way to do this.** This is the standard, correct approach for real-time updates with HoloSphere and Nostr relays.
