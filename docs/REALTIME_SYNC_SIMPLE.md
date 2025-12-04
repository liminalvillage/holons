# Real-Time Synchronization - Simple and Clean

## How It Works

When you do a `put()` in HoloSphere:
```javascript
await db.put('chatId/announcements', data);
```

It automatically publishes a Nostr event to the relay.

When you subscribe to that holon/lens in HoloSphere:
```javascript
holosphere.subscribe('chatId', 'announcements', (data) => {
  console.log('Update received:', data);
});
```

You automatically receive updates in real-time via WebSocket.

**That's it!** HoloSphere handles everything internally.

## Implementation

### Simple Helper Component

**File:** `src/components/HolosphereRealtimeSync.svelte`

```javascript
export function subscribeToLens(holonId, lens, callback) {
  return holosphere.subscribe(holonId, lens, callback);
}
```

Just a thin wrapper around HoloSphere's built-in `subscribe()` method.

### Using in Components

```javascript
import { subscribeToLens } from '../components/HolosphereRealtimeSync.svelte';

onMount(() => {
  const unsubscribe = subscribeToLens('chatId', 'announcements', (data) => {
    console.log('New announcement:', data);
    // Update your UI
  });

  return unsubscribe;
});
```

## What HoloSphere Does Internally

### On `put()`:

1. Creates Nostr event with `d-tag = "appName/holonId/lens/id"`
2. Publishes to relay via WebSocket
3. Relay broadcasts to subscribers

### On `subscribe()`:

1. Creates Nostr subscription filtered by `d-tag` prefix
2. Opens WebSocket connection to relay
3. Receives only events matching that holon/lens
4. Calls your callback with the data

## Example Flow

```
HolonsBot:
  db.put('123/announcements', {id: '1', content: 'Hello'})
    ↓
  HoloSphere creates event:
    {kind: 30000, tags: [['d', 'Holons/123/announcements/1']], ...}
    ↓
  Publishes to relay via WebSocket
    ↓
Relay:
  Receives event
  Broadcasts to subscribers with filter matching 'Holons/123/announcements'
    ↓
Harvest:
  holosphere.subscribe('123', 'announcements', callback)
  Receives event
  Calls callback({id: '1', content: 'Hello'})
    ↓
  UI updates
```

## Key Points

✅ **No manual broadcasting** - `put()` does it automatically
✅ **Filtered subscriptions** - Only receive updates for the holon/lens you subscribe to
✅ **Built into HoloSphere** - Just use `holosphere.subscribe()`
✅ **WebSocket relay** - Real-time updates via ws://localhost:7777
✅ **Automatic reconnection** - Handled by nostr-tools

## Usage Example

### Subscribe to Announcements

```javascript
// In your Svelte component
import { onMount } from 'svelte';
import { subscribeToLens } from '../components/HolosphereRealtimeSync.svelte';

let announcements = [];

onMount(() => {
  const unsubscribe = subscribeToLens('chatId', 'announcements', (data) => {
    announcements = [...announcements, data];
  });

  return unsubscribe; // Cleanup on component destroy
});
```

### Subscribe to Quests

```javascript
onMount(() => {
  const unsubscribe = subscribeToLens('chatId', 'quests', (quest) => {
    quests = [...quests, quest];
  });

  return unsubscribe;
});
```

### Subscribe to Any Lens

```javascript
onMount(() => {
  const unsubscribe = subscribeToLens(holonId, lensName, (data) => {
    // Handle update
  });

  return unsubscribe;
});
```

## Summary

- ✅ Use `holosphere.subscribe(holonId, lens, callback)` to receive real-time updates
- ✅ Use `db.put(holonId + '/lens', data)` to send updates (automatic broadcast)
- ✅ Updates are filtered by holon/lens (you only get what you subscribe to)
- ✅ Everything is handled by HoloSphere + relay WebSocket
- ✅ No unnecessary complexity

**That's all you need!**
