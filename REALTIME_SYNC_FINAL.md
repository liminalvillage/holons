# Real-Time Sync - Final Clean Implementation

## The Simple Truth

HoloSphere already has everything built-in. No extra components needed!

## How to Use

### In Any Component

```javascript
import { onMount, getContext } from 'svelte';

// Get holosphere from context
const holosphere = getContext('holosphere');

onMount(() => {
  // Subscribe to real-time updates
  const unsubscribe = holosphere.subscribe('chatId', 'announcements', (data) => {
    console.log('Real-time update:', data);
    // Update your UI
  });

  // Cleanup when component unmounts
  return unsubscribe;
});
```

That's it! No wrapper components, no extra setup.

## How It Works

### When HolonsBot does a `put()`:

```javascript
await db.put('chatId/announcements', announcement);
```

HoloSphere internally:
1. Creates Nostr event with `d-tag = "Holons/chatId/announcements/id"`
2. Publishes to relay via WebSocket (`ws://localhost:7777`)
3. Relay receives and broadcasts to subscribers

### When Harvest subscribes:

```javascript
holosphere.subscribe('chatId', 'announcements', callback);
```

HoloSphere internally:
1. Creates Nostr subscription filtered by `d-tag` prefix
2. Opens WebSocket to relay
3. Receives only events matching `"Holons/chatId/announcements/*"`
4. Calls your callback with the parsed data

**You only receive updates for the specific holon/lens you subscribed to.**

## Complete Example

```javascript
<script>
  import { onMount, getContext } from 'svelte';

  const holosphere = getContext('holosphere');

  let announcements = [];

  onMount(() => {
    // Subscribe to announcements for a specific chat
    const unsubscribe = holosphere.subscribe('chatId', 'announcements', (announcement) => {
      announcements = [...announcements, announcement];
    });

    return unsubscribe;
  });
</script>

{#each announcements as announcement}
  <div>{announcement.content}</div>
{/each}
```

## Multiple Subscriptions

```javascript
onMount(() => {
  const unsubAnnouncements = holosphere.subscribe('chatId', 'announcements', handleAnnouncement);
  const unsubQuests = holosphere.subscribe('chatId', 'quests', handleQuest);
  const unsubSettings = holosphere.subscribe('chatId', 'settings', handleSettings);

  return () => {
    unsubAnnouncements();
    unsubQuests();
    unsubSettings();
  };
});
```

## What's Running

1. **Relay:** `ws://localhost:7777` (running in background)
2. **HolonsBot:** Uses `db.put()` which auto-broadcasts
3. **Harvest:** Uses `holosphere.subscribe()` to receive updates

## Key Points

- ✅ No wrapper components needed
- ✅ Just use `getContext('holosphere')` and call `.subscribe()`
- ✅ Updates are filtered by holon/lens (you only get what you subscribed to)
- ✅ `put()` automatically broadcasts via relay
- ✅ Everything is handled by HoloSphere internally

## Summary

**There is no extra setup needed.**

HoloSphere + Relay already provide real-time synchronization out of the box:
- `holosphere.subscribe(holonId, lens, callback)` - Receive updates
- `db.put(holonId + '/lens', data)` - Send updates (auto-broadcast)

That's the entire system!
