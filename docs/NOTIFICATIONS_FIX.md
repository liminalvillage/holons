# Notification System - Import Error Fix

## Issue
```
SyntaxError: The requested module '/src/components/RealtimeNotifications.svelte'
does not provide an export named 'notifications'
```

## Root Cause
`NotificationToast.svelte` was trying to import `notifications` store directly from `RealtimeNotifications.svelte`, but Svelte components cannot export stores in that way.

## Solution
Created a shared store module that both components can import from.

### Files Changed

#### 1. Created: `src/lib/stores/notifications.ts`
A centralized notification store with:
- `notifications` writable store
- `addNotification()` function
- `markAsRead()` function
- `clearAll()` function
- TypeScript types for `Notification` and `NotificationType`

#### 2. Updated: `src/components/RealtimeNotifications.svelte`
- Removed local store definition
- Imports `addNotification` from shared store
- Removed duplicate functions (`markAsRead`, `clearAll`, `store` export)
- Now focuses only on subscription management

#### 3. Updated: `src/components/NotificationToast.svelte`
- Changed import from `./RealtimeNotifications.svelte` to `$lib/stores/notifications`
- Uses `$notifications` reactive statement for auto-updates
- Imports `markAsRead` from shared store
- Simplified `dismissNotification()` to use imported function

## Architecture

```
┌─────────────────────────────────┐
│ $lib/stores/notifications.ts    │
│ (Shared State)                  │
│                                 │
│ - notifications (writable)      │
│ - addNotification()             │
│ - markAsRead()                  │
│ - clearAll()                    │
└────────────┬────────────────────┘
             │
      ┌──────┴──────┐
      │             │
      ▼             ▼
┌─────────────┐  ┌──────────────────┐
│ Realtime    │  │ Notification     │
│ Notifica    │  │ Toast            │
│ tions.      │  │                  │
│ svelte      │  │ - Display toasts │
│             │  │ - Auto-dismiss   │
│ - Subscribe │  │ - Mark as read   │
│ - Add to    │  └──────────────────┘
│   store     │
└─────────────┘
```

## How It Works Now

1. **RealtimeNotifications.svelte:**
   - Subscribes to Nostr events via WebSocket
   - Receives events from relay
   - Calls `addNotification()` to add to shared store

2. **Shared Store** (`$lib/stores/notifications.ts`):
   - Maintains notification state
   - Provides functions to manipulate notifications
   - Can be imported anywhere in the app

3. **NotificationToast.svelte:**
   - Reactively subscribes to `$notifications`
   - Automatically updates when store changes
   - Displays toast UI
   - Calls `markAsRead()` on dismiss

## Benefits of This Approach

✅ **Separation of Concerns:**
- Store logic separated from UI components
- Reusable across multiple components

✅ **Type Safety:**
- Centralized TypeScript types
- Better IDE autocomplete

✅ **Svelte Best Practices:**
- Proper store usage with `$` prefix
- Reactive statements for auto-updates

✅ **Maintainability:**
- Single source of truth for notification state
- Easy to add new notification features
- Can be used in any component (not just toast)

## Testing

The app should now load without errors. You should see in the browser console:
```
[RealtimeNotifications] Subscribing to announcements...
[RealtimeNotifications] Subscription established (EOSE received)
```

To test notifications:
1. Send `/announce Test` in Telegram to HolonsBot
2. Toast notification should appear in Harvest
3. No import errors in console

## Future Extensions

Since notifications are now in a shared store, you can:

- Create a notification center/panel component
- Add notification history view
- Create notification badges (unread count)
- Add notification preferences
- Filter notifications by type
- Export notification data

All components can now import from `$lib/stores/notifications` and access the same state!
