# Real-Time Notifications System

This document explains how the real-time notification system works between the Relay, HolonsBot, and Harvest app.

## Architecture

The system uses a **Nostr relay** for real-time event broadcasting:

```
┌─────────────┐         WebSocket          ┌─────────────┐
│  HolonsBot  │────────(publish)──────────>│             │
│             │                             │   Relay     │
│ (Telegram)  │                             │ :7777       │
└─────────────┘                             │             │
                                            │ (Broadcast) │
┌─────────────┐         WebSocket          │             │
│   Harvest   │<──────(subscribe)──────────│             │
│  (Browser)  │                             └─────────────┘
└─────────────┘
```

## Components

### 1. Nostr Relay (`/Users/roberto/Projects/nostr-relay`)

**Location:** `/Users/roberto/Projects/nostr-relay/index.js`
**Port:** `ws://localhost:7777`

The relay server provides:
- Real-time WebSocket event broadcasting
- SQLite persistence (events survive restarts)
- Event indexing and filtering
- Rate limiting and connection management

**Starting the relay:**
```bash
cd /Users/roberto/Projects/nostr-relay
npm start
```

**Verify it's running:**
```bash
lsof -i :7777
```

### 2. HolonsBot (Publisher)

**Location:** `/Users/roberto/Projects/HolonsBot`

HolonsBot publishes announcement events to the relay when:
- A user creates an announcement via `/announce` command
- The announcement is stored in the database
- A Nostr event (kind 30000) is published to the relay

**Key files:**
- `Announcements.js:68-104` - `broadcastAnnouncementNotification()` method
- `DB.js` - HoloSphere initialization with relay config
- `relay-config.js` - Relay URL configuration

**Event format:**
```javascript
{
  kind: 30000,  // Parameterized replaceable event
  content: JSON.stringify({
    type: 'announcement',
    content: 'Announcement text',
    chatId: 123456,
    userId: 789,
    userName: 'John Doe',
    timestamp: 1699000000000,
    id: 12345
  }),
  tags: [
    ['d', 'announcement-123456-12345'],
    ['type', 'announcement'],
    ['chat', '123456']
  ]
}
```

### 3. Harvest App (Subscriber)

**Location:** `/Users/roberto/Projects/harvest`

Harvest subscribes to announcement events from the relay and displays real-time notifications.

**Key files:**
- `src/components/RealtimeNotifications.svelte` - Subscription manager
- `src/components/NotificationToast.svelte` - Visual notification UI
- `src/routes/+layout.svelte` - Integration point

**Features:**
- Real-time event subscription via WebSocket
- Toast notifications with auto-dismiss
- Browser notifications (with permission)
- Notification history tracking
- Supports multiple notification types (announcement, quest, update)

## How It Works

### 1. HolonsBot creates announcement

```javascript
// User sends: /announce Hello World
// In Announcements.js:
await this.db.put(chatID + '/announcements', announcement);
await this.broadcastAnnouncementNotification(announcement);
```

### 2. Event published to relay

```javascript
const event = await this.db.holosphere.client.publish({
  kind: 30000,
  content: JSON.stringify(notificationEvent),
  tags: [['d', `announcement-${chat}-${id}`], ...]
});
// Event is sent to ws://localhost:7777
```

### 3. Relay broadcasts to subscribers

```javascript
// In relay index.js:
broadcastToSubscriptions(event);
// All clients subscribed to kind 30000 receive the event
```

### 4. Harvest receives and displays

```javascript
// In RealtimeNotifications.svelte:
holosphere.client.subscribe({ kinds: [30000] }, (event) => {
  const content = JSON.parse(event.content);
  addNotification({
    type: 'announcement',
    title: '📢 New Announcement',
    message: content.content,
    ...
  });
});
```

### 5. User sees toast notification

The `NotificationToast.svelte` component displays:
- Animated toast in top-right corner
- Auto-dismiss after 5 seconds
- Click to dismiss manually
- Browser notification (if permitted)

## Configuration

### Shared Configuration

Both HolonsBot and Harvest use the same relay configuration:

```javascript
relays: [
  'ws://localhost:7777',       // Local relay for real-time
  'wss://relay.nostr.band'     // Backup public relay
]
```

### Shared Identity

Both use the same private key (set in `.env`):
```
VITE_HOLOSPHERE_PRIVATE_KEY=your_private_key_here
```

This allows them to:
- Share the same Nostr identity
- Access the same data across both systems
- Communicate securely

## Testing

### Prerequisites

1. **Start the relay:**
   ```bash
   cd /Users/roberto/Projects/nostr-relay
   npm start
   ```

   You should see:
   ```
   [Relay] Ready on ws://localhost:7777
   ```

2. **Start HolonsBot:**
   ```bash
   cd /Users/roberto/Projects/HolonsBot
   node HolonsBot.js
   ```

3. **Start Harvest:**
   ```bash
   cd /Users/roberto/Projects/harvest
   npm run dev
   ```

### Test Flow

1. Open Harvest in browser (usually `http://localhost:5173`)
2. Open browser console to see logs:
   ```
   [RealtimeNotifications] Subscribing to announcements...
   [RealtimeNotifications] Subscription established
   ```

3. In Telegram, send to your bot:
   ```
   /announce This is a test announcement!
   ```

4. Check HolonsBot logs:
   ```
   [Announcements] Broadcast notification event: abc123...
   ```

5. Check Relay logs:
   ```
   [Relay] Received EVENT: { kind: 30000, id: 'abc123...' }
   [Relay] Event broadcast to 1 subscriptions
   ```

6. Check Harvest browser console:
   ```
   [RealtimeNotifications] Received event: { kind: 30000, ... }
   [RealtimeNotifications] New notification: { type: 'announcement', ... }
   ```

7. You should see a toast notification appear in the top-right corner!

## Debugging

### Check if relay is running:
```bash
lsof -i :7777
# Should show node process
```

### Check relay logs:
The relay outputs logs for every:
- Client connection
- Event received
- Event broadcast

### Check Harvest subscription:
Open browser console and look for:
```
[RealtimeNotifications] Subscribing to announcements...
[RealtimeNotifications] Subscription established (EOSE received)
```

### Check HolonsBot publishing:
Look for in HolonsBot logs:
```
[Announcements] Broadcast notification event: <event-id>
```

### Common Issues

1. **No notifications appearing:**
   - Verify relay is running on port 7777
   - Check browser console for subscription logs
   - Verify HolonsBot is publishing events (check logs)

2. **Relay not starting:**
   - Port 7777 might be in use: `lsof -i :7777`
   - Kill existing process: `kill -9 <PID>`

3. **Harvest not receiving events:**
   - Check that both HolonsBot and Harvest use same relay URLs
   - Verify WebSocket connection in browser Network tab (WS filter)
   - Check that subscription kinds match (30000)

## Event Types

The system supports multiple notification types:

### Announcement (kind 30000)
```javascript
{
  type: 'announcement',
  title: '📢 New Announcement',
  icon: '📢',
  color: 'blue'
}
```

### Quest (kind 30001)
```javascript
{
  type: 'quest',
  title: '🎯 Quest Update',
  icon: '🎯',
  color: 'purple'
}
```

### Generic Update (kind 30002)
```javascript
{
  type: 'update',
  title: '🔄 Update',
  icon: '🔄',
  color: 'green'
}
```

## Extending the System

### Adding New Notification Types

1. **In HolonsBot:** Publish event with custom type
   ```javascript
   const event = await this.db.holosphere.client.publish({
     kind: 30001,  // Use different kind for quest
     content: JSON.stringify({ type: 'quest', ... }),
     tags: [['type', 'quest'], ...]
   });
   ```

2. **In Harvest:** Subscribe to new kind
   ```javascript
   holosphere.client.subscribe(
     { kinds: [30000, 30001] },  // Add new kind
     (event) => { /* handle */ }
   );
   ```

3. **Add UI styling** in `NotificationToast.svelte`:
   ```javascript
   function getNotificationIcon(type) {
     if (type === 'quest') return '🎯';
     // ...
   }
   ```

## Performance Considerations

- **Relay:** Handles up to 10,000 events with automatic cleanup
- **Rate limiting:** Max 10 events/second per client
- **Harvest:** Keeps max 50 notifications in memory
- **Auto-dismiss:** Toasts auto-dismiss after 5 seconds
- **Caching:** Events cached in relay database for persistence

## Security

- All events are signed with Nostr private keys
- Relay verifies event signatures before accepting
- Events are cryptographically linked to publisher identity
- WebSocket connections can be upgraded to WSS for production

## Production Deployment

For production, update relay URLs to use WSS:

```javascript
relays: [
  'wss://your-relay-domain.com',  // Your production relay
  'wss://relay.nostr.band'         // Backup public relay
]
```

And deploy the relay with:
- HTTPS/WSS support
- Proper firewall rules
- Database backups
- Monitoring and logging
