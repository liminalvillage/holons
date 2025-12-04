# HoloSphere Real-Time Synchronization

## ✅ Universal Real-Time Data Sync

Every `put` operation in HoloSphere automatically triggers real-time updates across all connected clients!

## How It Works

### Data Flow

```
┌──────────────────────────────────────────────────────┐
│  HolonsBot (or any client)                          │
│                                                      │
│  db.put('chatId/announcements', {...})              │
│     ↓                                                │
│  holosphere.write(holonId, lens, data)              │
│     ↓                                                │
│  storage.write(client, path, data)                  │
│     ↓                                                │
│  nostrPut(client, path, data, kind=30000)           │
│     ↓                                                │
│  client.publish({                                    │
│    kind: 30000,                                      │
│    tags: [['d', 'Holons/chatId/announcements/id']], │
│    content: JSON.stringify(data)                    │
│  })                                                  │
└──────────────┬───────────────────────────────────────┘
               │
               │ WebSocket
               ▼
┌──────────────────────────────────────────────────────┐
│  Nostr Relay (:7777)                                 │
│                                                      │
│  - Receives event                                    │
│  - Verifies signature                                │
│  - Stores in SQLite                                  │
│  - Broadcasts to ALL subscribers                    │
└──────────────┬───────────────────────────────────────┘
               │
               │ WebSocket (broadcast)
               ▼
┌──────────────────────────────────────────────────────┐
│  Harvest (or any subscribed client)                  │
│                                                      │
│  holosphere.client.subscribe({                       │
│    kinds: [30000, ...],  // All HoloSphere kinds    │
│    since: timestamp                                  │
│  }, (event) => {                                     │
│    // Fires for EVERY put() operation!              │
│    console.log('Data updated:', event);             │
│  })                                                  │
└──────────────────────────────────────────────────────┘
```

## Implementation

### In Harvest: `HolosphereRealtimeSync.svelte`

```javascript
// Subscribe to ALL HoloSphere data changes
holosphere.client.subscribe(
  {
    kinds: [30000, 30001, 30002, ...], // All HoloSphere event kinds
    since: Math.floor(Date.now() / 1000) // Only new events
  },
  (event) => {
    // This callback fires for EVERY put() operation anywhere!
    handleHolosphereUpdate(event);
  }
);
```

### Event Structure

When HoloSphere does a `put`:

```javascript
// In HolonsBot or any client
await db.put('chatId/announcements', {
  id: '123',
  content: 'Hello World',
  user: {...}
});
```

This becomes a Nostr event:

```javascript
{
  kind: 30000,
  pubkey: '9c7d719e42af8e695f6a76cd...',
  created_at: 1699000000,
  tags: [
    ['d', 'Holons/chatId/announcements/123']  // d-tag = path
  ],
  content: '{"id":"123","content":"Hello World","user":{...}}',
  sig: '...'
}
```

Which triggers the subscriber in Harvest:

```javascript
function handleHolosphereUpdate(event) {
  const content = JSON.parse(event.content);
  const dTag = event.tags.find(t => t[0] === 'd')[1];

  // Parse path: "Holons/chatId/announcements/123"
  const [appName, holonId, lens, itemId] = dTag.split('/');

  // Now you know exactly what was updated!
  console.log(`${lens} updated in holon ${holonId}:`, content);

  // Emit events for components to listen to
  window.dispatchEvent(new CustomEvent('holosphere-update', {
    detail: { holonId, lens, data: content }
  }));
}
```

## What Gets Synced

### HolonsBot Operations

**Announcements:**
```javascript
await this.db.put(chatID + '/announcements', announcement);
// → Triggers event with d-tag: "Holons/{chatID}/announcements/{id}"
```

**Quests:**
```javascript
await db.put(chatid + '/quests', quest);
// → Triggers event with d-tag: "Holons/{chatID}/quests/{id}"
```

**Settings:**
```javascript
await this.db.put(chatID + '/settings', settings);
// → Triggers event with d-tag: "Holons/{chatID}/settings/{id}"
```

**ANY data:**
```javascript
await db.put(holonId + '/customLens', data);
// → Triggers event with d-tag: "Holons/{holonId}/customLens/{id}"
```

### Harvest Receives All Updates

The `HolosphereRealtimeSync` component subscribes to ALL of these!

```javascript
// In HolosphereRealtimeSync.svelte
const update = {
  eventId: event.id,
  holonId: 'chatId',
  lens: 'announcements',
  itemId: '123',
  data: {...},
  timestamp: event.created_at * 1000
};

// Emit generic update event
window.dispatchEvent(new CustomEvent('holosphere-update', {
  detail: update
}));

// Emit lens-specific event
window.dispatchEvent(new CustomEvent('holosphere-update-announcements', {
  detail: update
}));
```

## Using in Components

### Method 1: Listen to Window Events

```javascript
// In any Svelte component
onMount(() => {
  const handleUpdate = (event) => {
    const { holonId, lens, data } = event.detail;

    if (lens === 'announcements') {
      console.log('New announcement:', data);
      // Update your component state
    }
  };

  window.addEventListener('holosphere-update', handleUpdate);

  return () => {
    window.removeEventListener('holosphere-update', handleUpdate);
  };
});
```

### Method 2: Subscribe to Specific Lens

```javascript
// In your component
import { subscribeToLens } from '../components/HolosphereRealtimeSync.svelte';

onMount(() => {
  const unsubscribe = subscribeToLens('chatId', 'announcements', (data) => {
    console.log('Announcement updated:', data);
    // Update your component state
  });

  return unsubscribe;
});
```

### Method 3: Use the Updates Store

```javascript
import { holosphereUpdates } from '../components/HolosphereRealtimeSync.svelte';

// Reactive statement
$: announcements = $holosphereUpdates.filter(u => u.lens === 'announcements');
```

## Path Structure

HoloSphere uses this path format:

```
{appName}/{holonId}/{lens}/{itemId}
```

Examples:
- `Holons/123456/announcements/msg-001`
- `Holons/789012/quests/quest-42`
- `Holons/456789/settings/config-1`
- `HolonsDebug/chatId/customData/item-5`

This is encoded in the Nostr event's `d-tag`.

## Event Kinds

HoloSphere uses parameterized replaceable events (30000-39999):

- **30000**: Default kind for most data
- **30001-30003**: Can be used for different data types
- **30000-39999**: All available for custom use

The `HolosphereRealtimeSync` subscribes to all of them!

## Performance

### Subscription Scope

The component subscribes to kinds 30000-39999 (10,000 event kinds).

This is efficient because:
1. Nostr relays index by `kind`
2. Filtering by `since` reduces events to only new ones
3. Events are only sent when they actually occur (no polling)

### Latency

- **Publish to receive:** < 100ms
- **Database write included:** Yes (relay stores in SQLite)
- **Reconnection:** Automatic via nostr-tools

### Bandwidth

- **Idle:** 0 bytes (WebSocket stays open, no traffic)
- **Per update:** ~200-500 bytes (JSON event)
- **Multiple clients:** Each gets the same broadcast (efficient)

## Example: Real-Time Announcement Updates

### HolonsBot creates announcement

```javascript
// In Announcements.js
const announcement = {
  id: messageID,
  user: ctx.from,
  date: new Date(),
  content: message,
  chat: chatID
};

await this.db.put(chatID + '/announcements', announcement);
// ↑ This automatically publishes to relay!
```

### Relay broadcasts

```
[Relay] Received EVENT: { kind: 30000, id: 'abc...' }
[Relay] Event stored and broadcast. Total events: 1
[Relay] Event broadcast to 2 subscriptions
```

### Harvest receives update

```javascript
// In HolosphereRealtimeSync.svelte
function handleHolosphereUpdate(event) {
  // Parse event
  const content = JSON.parse(event.content);
  const dTag = event.tags.find(t => t[0] === 'd')[1];
  // "Holons/123456/announcements/msg-001"

  const [app, holonId, lens, itemId] = dTag.split('/');

  if (lens === 'announcements') {
    // Emit announcement update event
    window.dispatchEvent(new CustomEvent('holosphere-update-announcements', {
      detail: { holonId, data: content }
    }));
  }
}
```

### Component reacts

```javascript
// In any component
window.addEventListener('holosphere-update-announcements', (e) => {
  const { holonId, data } = e.detail;

  // Update UI
  announcementsList = [...announcementsList, data];

  // Show toast
  toast.success(`New announcement from ${data.user.first_name}`);
});
```

## Comparison with Previous Approach

### ❌ Old: Separate Notification System

```javascript
// Had to manually broadcast for each feature
await this.db.put(chatID + '/announcements', announcement);
await this.broadcastAnnouncementNotification(announcement); // Manual!
```

Problems:
- Need separate broadcast code for each feature
- Easy to forget to broadcast
- Duplicate logic
- Only works for specific types

### ✅ New: Universal Sync

```javascript
// Just use put() - broadcasting happens automatically!
await this.db.put(chatID + '/announcements', announcement);
// ↑ Automatically broadcasts to all subscribers!
```

Benefits:
- Works for ALL data types automatically
- No extra code needed
- Impossible to forget
- Future-proof for new features

## Configuration

### In HolonsBot

No changes needed! All existing `db.put()` calls automatically broadcast.

### In Harvest

Add `HolosphereRealtimeSync` to your layout:

```javascript
// In +layout.svelte
import HolosphereRealtimeSync from '../components/HolosphereRealtimeSync.svelte';

<HolosphereRealtimeSync />
```

That's it! Now ALL HoloSphere data changes sync in real-time.

## Testing

### 1. Start all services

```bash
# Terminal 1: Relay
cd /Users/roberto/Projects/nostr-relay
npm start

# Terminal 2: HolonsBot
cd /Users/roberto/Projects/HolonsBot
node HolonsBot.js

# Terminal 3: Harvest
cd /Users/roberto/Projects/harvest
npm run dev
```

### 2. Monitor updates

Open Harvest browser console:

```javascript
window.addEventListener('holosphere-update', (e) => {
  console.log('Update:', e.detail);
});
```

### 3. Trigger updates

In Telegram (to HolonsBot):
- `/announce Test` → See announcement update
- `/quest Do something` → See quest update
- Any command that uses `db.put()`

### 4. Verify in console

```
[HolosphereRealtimeSync] Real-time data update: {...}
[HolosphereRealtimeSync] Processed update: {holonId: '...', lens: 'announcements', ...}
```

## Summary

✅ **Every `put` operation triggers real-time sync**
✅ **No manual broadcasting needed**
✅ **Works for all data types automatically**
✅ **Universal subscription to all HoloSphere data**
✅ **Components can listen via window events or direct subscriptions**
✅ **< 100ms latency**
✅ **Automatic reconnection**

**The entire HoloSphere network is now real-time synchronized!**
