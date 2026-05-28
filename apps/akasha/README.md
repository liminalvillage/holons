<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# akasha

A minimal, touch-first **kiosk PWA** for the entrance of the hub. One vertical
screen, three views, auto-rotating between them unless someone is interacting:

1. **Calendar** — the month at a glance, with post-it notes for what's coming up.
2. **Tasks** — the backlog, as a wall of sticky notes.
3. **Library** — the library of things, and what's available to borrow.

_Less is more._ No login, no chrome, no settings on screen — just the holon's
life, served read-only and local-first from [Holosphere](https://gun.eco).

## How it works

- **Fully independent** SvelteKit SPA (`@sveltejs/adapter-static`, served as
  plain files from anywhere). It depends only on `holosphere` and `@holons/core`
  — it reuses the shared HoloSphere factory and library domain helpers, and
  re-implements no domain rules of its own (core owns meaning).
- **Live data:** subscribes to the holon's `quests` lens (calendar events + task
  backlog) and `library` lens.
- **Tap to zoom:** any post-it or card comes forward into a detail card showing
  everything about it. Viewing is open to all.
- **Edit when logged in:** sign in with Telegram (Login Widget on the web, or the
  native WebApp identity inside Telegram) to edit events/tasks, mark them
  complete, and borrow / return library things. Not logged in → a friendly
  "log in to edit" prompt. The kiosk holds its own device key to _sign_ writes;
  the acting identity recorded on each write is the logged-in user (`actingAs`),
  exactly as the bot writes on behalf of chat members. Borrowing/lending meaning
  comes from `@holons/core/library` — no domain rules are re-implemented here.
- **Auto-rotation:** advances one tab every 16s; any touch/scroll/key pauses it
  and it resumes after 30s of stillness. A thin bar under the active tab shows
  time to the next flip. Rotation freezes while a detail card is open.
- **PWA:** installable, fullscreen, portrait-locked, with an offline app shell.

## Configuration

Akasha shares the monorepo-root `.env`. It reads exactly two vars (see
[`.env.example`](./.env.example)), each overridable per device via a URL query
param that's then remembered in `localStorage`:

| What          | Env var             | URL param     | Default  |
| ------------- | ------------------- | ------------- | -------- |
| Holon to show | `VITE_AKASHA_HOLON` | `?holon=<id>` | _(none)_ |
| App namespace | `VITE_HOLONS_APP`   | `?app=<name>` | `Holons` |

To pin a screen the first time, just open it once at
`https://…/?holon=<holon-id>` (add `&app=Holons` for production data).

**Editing** is optional and off until configured. Set
`VITE_TELEGRAM_BOT_USERNAME` to the hub's bot (and point that bot's domain at
the kiosk origin via `@BotFather` `/setdomain`) to enable the Telegram Login
Widget. In dev, `VITE_DEV_TELEGRAM_USER_*` auto-signs-in so you can exercise
editing without the widget.

## Develop

```bash
pnpm -F akasha dev       # http://localhost:5273
pnpm -F akasha build     # static build → ./build
pnpm -F akasha preview   # serve the production build
```

## License

AGPL-3.0-or-later — see [`LICENSING.md`](../../LICENSING.md).
