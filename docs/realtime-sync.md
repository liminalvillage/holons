# Real-time sync

How data stays live across UIs, devices, and federated holons. This is the
single source of truth.

## The transport

Sync is provided by the workspace `holosphere` package. The **Nostr relays
are the wire** and a **local event-sourced store** is the cache
(`packages/holosphere/STORE.md`).

- Every non-private write is a signed kind-30078 event (NIP-33 replaceable
  per `holon/lens/id`, tagged with the app namespace) published to the
  relays. Deletes are signed tombstones.
- Production relays: `wss://relay.holons.io` and `wss://relay.commonshub.dev`
  (`DEFAULT_RELAYS` in `@holons/core/holosphere`). Override with
  `VITE_HOLOSPHERE_RELAYS` (web), `VITE_KIOSK_RELAYS` (kiosk) or
  `HOLOSPHERE_RELAYS` (bot, MCP, scripts).
- The first read or subscription of a `(holon, lens)` backfills it from the
  relays (paginated, newest first) and records a cursor; afterwards one live
  REQ per pair keeps the store current, and a reconnect or a tab coming back
  online re-queries from the cursor.
- The store persists in IndexedDB in browsers, a JSONL log + snapshot on
  long-lived Node hosts, and memory in serverless functions and scripts. A
  reload paints from the store immediately, then catches up.
- Conflicts: newer `created_at` wins; ties go to the larger event id.

There is no separate relay process to run for development; the production
relays are the default. `packages/holosphere/spike/mini-relay.js` is an
in-process relay for tests.

## How the web app initializes it

`apps/web/src/routes/+layout.svelte` is the single web entry point:

1. The splash screen (`Splash.svelte`) resolves an identity — a locally
   stored Nostr key, a freshly generated key, a Telegram-mapped session, or
   a `?key=` URL parameter — and emits an `authenticated` event.
2. `initHoloSphere(privateKey)` builds one `HoloSphere` through the core
   factory:

   ```ts
   holosphere = await createHoloSphere({
     appName: environmentName,                        // VITE_HOLONS_APP
     privateKey: hexToBytes(privateKey),
     relays: resolveRelays(import.meta.env.VITE_HOLOSPHERE_RELAYS),
     store: { adapter: 'indexeddb' },
     signing: signingOptionsFor(parseSigningMode(import.meta.env.VITE_HOLOSPHERE_SIGNING)),
     nostr: projectionOptions,                        // standard-kind projections
     awaitReady: true,                                // store open + transport up
   });
   ```

3. The instance is published to `holosphereStore`
   (`apps/web/src/lib/stores/holosphere.ts`). Components read it reactively
   or via `getHolosphere()`.
4. The user's personal holon settings are initialized
   (`initializeUserHolon`) with retry, because the first relay sync of a
   lens may take a moment.

App namespace selection: `import.meta.env.VITE_HOLONS_APP` is the single
source of truth, falling back to `Holons` in production / `HolonsDebug`
otherwise.

## Live updates in components

Real-time UI is driven by `holosphere.subscribe(holonId, lens, callback)`.
Internally it is a `store.watch` on the `(holon, lens)`: the current
snapshot is replayed to the new subscriber on a microtask, then every
accepted event (local writes and relay arrivals alike) fires once. The
callback receives parsed data with holograms resolved (federation
provenance followed); a deletion arrives as `null` for that key. The
returned object exposes `unsubscribe()`.

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

Because every UI publishes to the same relays under the same namespace, a
`put` from the Telegram bot, the MCP server, or another browser appears in
any subscribed view without extra wiring — there is no manual broadcast
step. `apps/web/src/lib/holosphere/QueryManager.ts` coalesces bursts of
per-item emissions into one re-render per microtask.

## Writes

Writes go through `@holons/core/holosphere`'s `writeWithIdentity()` /
`createHolonWriter()`, which call `holosphere.put(holonId, lens, data, {
actingAs })`. The put signs the record, applies it to the local store
(subscribers fire synchronously) and publishes it to the relays.
Authorization failures are turned into a `false` return plus an optional
`onDenied` callback rather than thrown (see
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
(`apps/web/src/routes/+layout.svelte`, `setupFederationDMSubscription`).
Messages travel as NIP-17 private messages (NIP-59 gift wrap, NIP-44) on the
same relays. It handles four message kinds, each dispatched as a `window`
CustomEvent for UI components to react to:

| Handler | CustomEvent | Purpose |
| --- | --- | --- |
| `onRequest` | `federationRequest` | Another holon asks to federate. |
| `onResponse` | `federationResponse` | Reply to our request; on `accepted`, federation is completed locally (`processFederationResponse` + `federateHolon`). |
| `onUpdate` | `federationUpdate` | Partner changes lens config — surfaced for approval, never auto-accepted. |
| `onUpdateResponse` | `federationUpdateResponse` | Reply to one of our update requests. |

The subscription is torn down in the layout's `onDestroy`.

## Notifications

The current in-app notifications are:

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
  `holosphere.subscribe`. The console logs the relay count and signing mode
  after init.
- **Data missing right after load**: the first sync of a lens is not
  instant, and a lens this device has never touched has nothing in the
  store yet. `initializeUserHolon` already retries settings reads; mirror
  that pattern for other first-read paths rather than assuming data is
  present.
- **Stale data after a long offline period**: the store catches up from its
  cursor on reconnect; `holosphere.resyncSubscriptions()` forces a re-query
  of every synced lens.
- **Self-hosting**: run any NIP-01 relay (strfry is what production uses)
  and point the relay env at it; the production relays are only a
  convenience default, not a requirement.
