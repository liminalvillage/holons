<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# kiosk

A minimal, touch-first **kiosk PWA** for the entrance of the hub. One vertical
screen, three views, auto-rotating between them unless someone is interacting:

1. **Calendar** — the month at a glance, with post-it notes for what's coming up.
2. **Tasks** — the backlog, as a wall of sticky notes.
3. **Library** — the library of things, and what's available to borrow.

_Less is more._ Just the holon's life, served read-only and local-first from
[Holosphere](https://gun.eco) — with a small caretaker **Settings** panel for
the few knobs that matter.

## How it works

- **Fully independent** SvelteKit SPA (`@sveltejs/adapter-static`, served as
  plain files from anywhere). It depends only on `holosphere` and `@holons/core`
  — it reuses the shared HoloSphere factory and library domain helpers, and
  re-implements no domain rules of its own (core owns meaning).
- **Live data:** subscribes to the holon's `quests` lens (calendar events + task
  backlog) and `library` lens.
- **Show & Layout pills:** every content tab carries a **Show** pill choosing
  whose items appear — **Mine** (only the logged-in user's), **All** (this
  holon), or **Network** (this holon plus its federation partners, resolved
  from `@holons/core/federation`'s `getFederationSnapshot`; partner items
  carry a small `⇄ <partner>` source chip) — and, where a tab has more than
  one layout, a separate **Layout** pill (e.g. Tasks: cards / list /
  post-its). Both choices are remembered on the device.
- **Settings:** the ⚙ button opens a panel to choose which holon the screen
  shows, set a **display name** and **logo** for the header (logo uploaded and
  stored on the device), and jump to the full dashboard. Choices are
  remembered on the device; the live subscriptions re-point without a reload.
- **Production by default:** the entrance display reads the production `Holons`
  namespace from the production Gun relay — independent of the shared dev
  `VITE_HOLONS_APP`. Override per-screen with `VITE_KIOSK_APP` / `VITE_KIOSK_PEER`.
- **Holon button:** the ⬡ button opens the holon's full web dashboard at
  `https://dashboard.holons.io/<holon-id>` in a new tab.
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

The kiosk shares the monorepo-root `.env`. It reads exactly two vars (see
[`.env.example`](./.env.example)), each overridable per device via a URL query
param or the in-app **Settings** panel, then remembered in `localStorage`:

| What          | Env var            | URL param / Settings   | Default                     |
| ------------- | ------------------ | ---------------------- | --------------------------- |
| Holon to show | `VITE_KIOSK_HOLON` | `/<id>`, `?holon=<id>` | _(none)_                    |
| App namespace | `VITE_KIOSK_APP`   | `?app=<name>`          | `Holons` (production)       |
| Gun relay     | `VITE_KIOSK_PEER`  | —                      | `https://gun.holons.io/gun` |

To pin a screen the first time, open it once at `https://…/?holon=<holon-id>`,
or open **Settings** and type the id. To _visit_ a holon without re-pointing the
device, open `https://…/<holon-id>` (or `/<registered label>`, e.g. `/liminal`)
— the path wins for that page load but is not remembered. The kiosk reads
production data by default.

**Editing** is optional and off until configured. Set
`VITE_TELEGRAM_BOT_USERNAME` to the hub's bot to enable the Telegram Login
Widget. The bot's login domain must be registered as **`hubs.network`** via
`@BotFather` `/setdomain` — Telegram honours that domain and all its subdomains,
so a single `/setdomain hubs.network` authorises every `*.hubs.network` kiosk.
In dev, `VITE_DEV_TELEGRAM_USER_*` auto-signs-in so you can exercise editing
without the widget.

## Voice

The voice widget (hold-to-talk + typed transcripts) runs one of two pipelines
behind the same UI:

| Mode     | Pipeline                                                                                                                          | Enable with                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `ws`     | A [`@holons/voice-ui`](../../packages/voice-ui) server owns STT → agent → TTS (local models or hosted APIs)                       | `VITE_VOICE_WS_URL` (defaults to probing `ws://localhost:8787`)      |
| `direct` | The browser itself calls the OpenAI API: Whisper STT → chat-completions agent loop with in-page tools over Holosphere → tts-1 TTS | An OpenAI API key entered in **Settings** (kept on that device only) |

Direct mode needs no companion server — a deployed kiosk speaks on its own.
The caretaker pastes an OpenAI API key into **Settings → Voice**; it is stored
in the device's `localStorage` (never in the deployed bundle) and applies
immediately, so each kiosk site/device carries its own key. Clearing the field
turns voice off again. Use a dedicated, spending-capped key per hub, since
anyone with physical access to the device could read it.

`VITE_VOICE_MODE=ws|direct` picks the mode explicitly; otherwise an explicit
`VITE_VOICE_WS_URL` keeps `ws`, else an available key enables `direct`. With
neither, the buttons stay hidden. For local dev, `VITE_OPENAI_API_KEY` in the
root `.env` acts as a fallback key (do **not** set it on Netlify — it would
bake the key into the public bundle). Optional model overrides:
`VITE_VOICE_LLM_MODEL` (`gpt-4o-mini`), `VITE_VOICE_STT_MODEL` (`whisper-1`),
`VITE_VOICE_TTS_MODEL` (`tts-1`), `VITE_VOICE_TTS_VOICE` (`alloy`).

## Develop

```bash
pnpm -F kiosk dev       # http://localhost:5273
pnpm -F kiosk build     # static build → ./build
pnpm -F kiosk preview   # serve the production build
```

## Deploy (Netlify, multi-tenant)

**One deploy serves every registered holon.** Point a wildcard domain
(`*.hubs.network`) at a single Netlify site; the app reads the host's subdomain
at runtime and looks up the holon in [`src/lib/holons.ts`](./src/lib/holons.ts):

```ts
// src/lib/holons.ts
export const SUBDOMAIN_HOLONS: Record<string, string> = {
  liminal: "-1001234567890", // liminal.hubs.network → this holon
  // …one line per registered holon
};
```

Resolution order is `?holon=<id>` → URL path `/<id|label>` → subdomain →
Settings/localStorage → `VITE_KIOSK_HOLON`, so a registered subdomain is
authoritative for its host while `/<id>` deep-links any holon and `?holon=`
still works for testing.

- **Git deploy:** [`netlify.toml`](./netlify.toml) builds `@holons/core` then the
  kiosk and publishes `apps/kiosk/build` as a static SPA. In the Netlify site
  settings, set the **base directory** to `apps/kiosk`.
- **Manual deploy:** [`deploy.sh`](./deploy.sh) (needs the Netlify CLI + a linked
  site):

  ```bash
  pnpm -F kiosk deploy:preview   # draft preview URL
  pnpm -F kiosk deploy           # production
  ```

> The apps consume core's **compiled `dist`**, so every deploy rebuilds
> `@holons/core` first — a change to `packages/core` won't take effect otherwise.

## License

AGPL-3.0-or-later — see [`LICENSING.md`](../../LICENSING.md).
