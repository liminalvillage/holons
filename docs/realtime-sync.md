# Real-time sync

How data stays live across UIs, devices, and federated holons. This is the
single source of truth — it supersedes the older websocket/notification
scratch notes.

> Earlier docs described a custom Nostr relay at `ws://localhost:7777` plus
> `wss://relay.nostr.band`, and components named `RealtimeNotifications.svelte`
> / `NotificationToast.svelte`. None of that reflects the current code. What
> follows does.

## The transport

Sync is provided by the pinned `holosphere@1.3.0-alpha5` package, which runs
on **GunDB** — a peer-to-peer graph database with its own real-time sync
layer over WebSocket/HTTP.

- Default Gun peer: `https://gun.holons.io/gun` (set in holosphere's
  constructor defaults). This is the shared backend every UI talks to.
- In the browser, holosphere enables `radisk` (IndexedDB-backed
  persistence) and disables `localStorage`, so data survives reloads and
  syncs back when the peer is reachable.
- The constructor also accepts `nostr: { relays | peers }`. Those URLs are
  **not** opened as Nostr relays today — holosphere rewrites them to Gun
  HTTP peers (`wss://host` → `https://host/gun`). It is a
  forward-compatibility seam for a future native Nostr backend; the web app
  keeps that path commented out (`apps/web/src/routes/+layout.svelte`,
  `apps/web/src/routes/[id]/calendar/feed.ics/+server.ts`).

There is no separate relay process to run for development. Pointing at
`gun.holons.io` (the default) is enough; an explicit peer list is only
needed for self-hosting.

## How the web app initializes it

`apps/web/src/routes/+layout.svelte` is the single web entry point:

1. The splash screen (`Splash.svelte`) resolves an identity — a locally
   stored Nostr key, a freshly generated key, a Telegram-mapped session, or
   a `?key=` URL parameter — and emits an `authenticated` event.
2. `initHoloSphere(privateKey)` constructs one `HoloSphere`:

   ```ts
   holosphere = new HoloSphere({
     appName: environmentName,                 // VITE_HOLONS_APP or Holons/HolonsDebug
     privateKey: hexToBytes(privateKey),
     // backend: 'nostr' / nostr: { peers: [...] }  // future Nostr backend (commented)
   });
   await holosphere.ready();                    // wait for backend init
   ```

3. The instance is published to `holosphereStore`
   (`apps/web/src/lib/stores/holosphere.ts`). Components read it reactively
   or via `getHolosphere()`.
4. The user's personal holon settings are initialized
   (`initializeUserHolon`) with retry, because freshly connected peers may
   take a moment to sync.

App namespace selection: `import.meta.env.VITE_HOLONS_APP` is the single
source of truth, falling back to `Holons` in production / `HolonsDebug`
otherwise.

## Live updates in components

Real-time UI is driven by `holosphere.subscribe(holonId, lens, callback)`.
Internally (holosphere `utils.js`) this is:

```js
gun.get(appName).get(holonId).get(lens).map().on((data, key) => { ... })
```

so it is a Gun graph listener over the live peer connection — every peer
that writes to that holon/lens pushes an update to every subscriber. The
callback receives parsed data with holograms resolved (federation
provenance followed). The returned object exposes `unsubscribe()`.

Typical component pattern (used in ~25 web components, e.g.
`apps/web/src/components/Offers.svelte`, `Tasks.svelte`):

```ts
onMount(() => {
  let sub: { unsubscribe: () => void } | null = null;
  (async () => {
    sub = await holosphere.subscribe(holonId, 'quests', (item, key) => {
      // merge item into local reactive state
    });
  })();
  return () => sub?.unsubscribe();
});
```

Because the same Gun namespace backs every UI, a `put` from the Telegram
bot, the MCP server, or another browser appears in any subscribed view
without extra wiring — there is no manual broadcast step.

## Writes

Writes go through `@holons/core/holosphere`'s `writeWithIdentity()` /
`createHolonWriter()`, which call `holosphere.put(holonId, lens, data, {
actingAs })`. Gun propagates the change to connected peers; subscribers fire
their `.on()` callbacks. Authorization failures are turned into a `false`
return plus an optional `onDenied` callback rather than thrown (see
[architecture.md](./architecture.md)).

### Bot-refresh hook (web only)

When `VITE_BOT_API_URL` is set (or in dev, defaulting to
`http://localhost:8080`), the web layout monkey-patches `holosphere.put` so
that writes to `quests`, `expenses`, or `events` also POST to the bot's
idempotent `/refresh/<kind>` endpoint. That lets the Telegram bot create or
edit the corresponding Telegram message for the touched entity. It is a
no-op when no bot URL is configured.

## Federation messaging

Beyond per-lens data sync, the web root layout opens one global federation
DM subscription via holosphere's `handshake.subscribeToFederationDMs`
(`apps/web/src/routes/+layout.svelte`, `setupFederationDMSubscription`). It
handles four message kinds, each dispatched as a `window` CustomEvent for UI
components to react to:

| Handler | CustomEvent | Purpose |
| --- | --- | --- |
| `onRequest` | `federationRequest` | Another holon asks to federate. |
| `onResponse` | `federationResponse` | Reply to our request; on `accepted`, federation is completed locally (`processFederationResponse` + `federateHolon`). |
| `onUpdate` | `federationUpdate` | Partner changes lens config — surfaced for approval, never auto-accepted. |
| `onUpdateResponse` | `federationUpdateResponse` | Reply to one of our update requests. |

The subscription is torn down in the layout's `onDestroy`.

## Notifications

There is no Nostr-event notification subsystem. The current in-app
notifications are:

- `apps/web/src/lib/stores/writeNotifications.ts` +
  `apps/web/src/components/WriteNotificationToast.svelte` — toasts for
  write-permission denials returned by `writeWithIdentity`. Auto-dismiss
  after 5s.
- `apps/web/src/dashboard/browser/LensUpdateNotification.svelte` — the
  approval card shown when a federation partner proposes a new lens config
  (driven by the `federationUpdate` event above).
- `apps/web/src/components/PermanentAssignmentNotification.svelte` — role
  assignment notice.

## Troubleshooting

- **No live updates**: confirm `holosphereStore` is set (the splash
  completed and `initHoloSphere` ran) and the component actually called
  `holosphere.subscribe`. Check the browser console for the logged public
  key after `holosphere.ready()`.
- **Data missing right after load**: first-connection peer sync is not
  instant. `initializeUserHolon` already retries settings reads; mirror that
  pattern for other first-read paths rather than assuming data is present.
- **Self-hosting a peer**: run a Gun relay peer and pass it via the
  holosphere config; the default `gun.holons.io` peer is only a convenience
  default, not a requirement.
