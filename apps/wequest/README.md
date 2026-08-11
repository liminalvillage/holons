# WeQuest

_A list is a signal._ Mobile-first client of the geolocated needs network
(see [`docs/needs-offers-network.md`](../../docs/needs-offers-network.md)),
fully live on the **Holosphere** backend — the same decentralized GUN graph
the web dashboard, kiosk, and Telegram bot share. Designed in the Claude
Design project **WeQuest App** (Organic design system — Caprasimo + Figtree,
terracotta and sage on warm paper).

## What is live

Every screen reads and writes real lenses through `@holons/core`:

| Screen    | Backend                                                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| List      | `(holon, 'checklists', 'shopping')` via `@holons/core/shopping`; items are stamped with their published `needId`                                     |
| Compose   | `addItem` + `publishNeedNearby` — the "how far should it travel" ring maps to hex-hologram upcast levels (cell-only → 2 → 5 → partners + full climb) |
| Home feed | own `type:'need'` quests with embedded responses; "I can provide" shows open federated needs via `subscribeFederated`                                |
| Home map  | H3 neighbourhood around `settings.hex`, heat = open needs read live from each cell's `needs` lens                                                    |
| Quest     | respond (`respondToNeed`, `sourceRef`-routed to the owner holon) and accept (`claimNeed`)                                                            |
| Handoff   | `closeNeed('fulfilled')` + a real `hour` expense on the `expenses` lens — both wallets change                                                        |
| Coop      | members from `users`, live demand bars, `type:'proposal'` quests with participant-toggle voting, treasury from hour balances                         |
| Barter    | the holon's real federation links                                                                                                                    |
| Wallet    | `computeUserCurrencyBalance` over `expenses` + karma from `@holons/core/scoring` over `rea_events`                                                   |
| Profile   | `users`-lens profile (values/needs) + completed quests as the record                                                                                 |

## Run

```bash
pnpm install
pnpm -F wequest dev        # → http://localhost:5373
```

First launch asks for a **holon id** and **user id** (or pass them in the URL
— everything persists to localStorage):

```
http://localhost:5373/?holon=<holonId>&user=<userId>&username=<name>
# optional: &app=<namespace>   (default "Holons" — use HolonsDebug for testing)
```

Env fallbacks in the root `.env` (see `.env.example` at the repo root):
`VITE_WEQUEST_HOLON`, `VITE_WEQUEST_APP`, `VITE_WEQUEST_PEER` (defaults to
the production relay `gun.holons.io`), `VITE_MAPBOX_TOKEN` (real basemap),
`VITE_BOT_API_URL` (need-lifecycle DMs through the Telegram bot). An
unconfigured **dev** run lands in the `HolonsDebug` namespace; only
production builds default to the live `Holons` graph.

The demand-heat map needs the holon to have a Hex Address in its settings
(dashboard → Settings → "Pick a hex on the map"); without one the app still
works and says so.

## Verify

```bash
pnpm -F wequest typecheck && pnpm -F wequest test && pnpm -F wequest build
```

The full two-user flow (post need → answer → accept → two-sided handoff →
hours move) is verified by hand: open two browsers on a scratch holon in the
`HolonsDebug` namespace (`?holon=<scratch>&app=HolonsDebug&user=<id>`, one
user per browser) and walk the loop — never point test writes at the
production `Holons` namespace. The pure logic (hex geometry, map
projection) is covered by the vitest specs; the handoff/settlement domain
logic is tested in `@holons/core/needs`.

## License

AGPL-3.0-or-later — see [`LICENSING.md`](../../LICENSING.md).
