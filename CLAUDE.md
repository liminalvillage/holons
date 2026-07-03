# CLAUDE.md

Guidance for AI coding agents (and humans) working in this repository. It
supersedes the old single-repo `VIBE.md`/`docs/CLAUDE.md` constitution, which
described a pre-monorepo layout.

## What this repository is

A **pnpm monorepo** for Holons — agent-centric, federated group coordination.
One UI-agnostic domain core, five interfaces over it.

```
apps/web/              harvest-web — Svelte 5 / SvelteKit dashboard
packages/core/         @holons/core — ALL domain logic (TypeScript)
packages/telegram-ui/  Telegraf bot (mixed JS+TS, migrating)
packages/text-ui/      CLI / REPL
packages/ai-ui/        Claude tool-use NL interface
packages/mcp-ui/       Model Context Protocol server
```

Data layer: **Holosphere**, namespaced per holon, over a pluggable
`StorageBackend`. Default is a decentralized [GUN](https://gun.eco) graph
(peer-to-peer, local-first); an optional [AD4M](https://ad4m.dev) backend maps
holons→perspectives and lenses→subject classes. Select via
`VITE_HOLOSPHERE_BACKEND` (`gun` default, or `ad4m`).

License: **AGPL-3.0-or-later** with a commercial option — see
[`LICENSING.md`](./LICENSING.md). New source files get the SPDX header.

## Non-negotiable rules

1. **Core owns meaning; UIs only render.** Change behavior in
   `@holons/core/<domain>`; never re-implement domain rules inside a UI.
2. **No UI imports in core.** `@holons/core` must not import `svelte`,
   `telegraf`, etc. Type-only imports are acceptable.
3. **Subpath imports only.** `import { x } from '@holons/core/<domain>'`. No
   cross-domain barrel re-exports; each domain's public API is its
   `src/<domain>/index.ts`.
4. **One Holosphere factory.** All identity-aware reads/writes go through
   `@holons/core/holosphere`. Never `new HoloSphere()` in a UI.
5. **Test-first for domain logic.** Every `@holons/core` change ships with a
   `vitest` spec next to it.
6. **Never commit secrets.** `.env`, `.env.*`, `.mcp.json` are gitignored. If a
   secret is exposed, the fix is to **rotate it**, not just delete it.
7. **Gate before done:** `pnpm -r typecheck && pnpm test && pnpm lint` must
   pass from a clean state. Sign off commits (`git commit -s`).

## Working effectively

- Understand before acting — this is a distributed, eventually-consistent
  system. Read [`docs/architecture.md`](./docs/architecture.md) and the target
  domain's `index.ts` + tests first.
- Prefer the smallest change that satisfies the requirement; match the style of
  the file you touch (the bot is mixed JS/TS by design).
- Clean up Holosphere/Gun subscriptions and timers; assume async, eventual
  consistency — don't force synchronous reads.
- Keep the working tree clean: no `build/`, `.svelte-kit/`, `radata/`, or
  `.env` in commits.
- Conventional Commits with a scope: `core/scoring: …`, `web: …`, `docs: …`.

## Common commands

```bash
pnpm install                       # workspace install (committed lockfile)
pnpm -r typecheck                  # typecheck all packages
pnpm test                          # vitest across packages
pnpm -F @holons/core test          # one package
pnpm dev                           # web UI  → http://localhost:5173
pnpm dev:bot                       # Telegram bot
pnpm -F @holons/text-ui exec holons --help
```

## AD4M backend (optional)

Holosphere storage is pluggable (`packages/holosphere/backends/`). GUN is the
default; AD4M is opt-in via `VITE_HOLOSPHERE_BACKEND=ad4m`. Mapping: holon →
perspective, lens → subject class, item → subject instance, key →
base-expression URI.

- **Two modes.** Given lens JSON Schemas (`packages/core/schemas/`, bundled for
  the browser by `core/holosphere/ad4mSchemas.ts`), each lens gets a *dedicated*
  typed subject class that persists only its declared properties. Given an empty
  schema map, the backend runs *opaque*: every lens uses one `GenericLensModel`
  that round-trips the whole payload as a JSON string. Apps run dedicated; the
  conformance suite runs opaque (the opaque-KV contract GUN also satisfies).
- **Gotcha — never declare an `id` property on a subject model.** AD4M reserves
  `id` as the alias for a subject's base-expression URI. If a model declares `id`
  as data, `findAll` hydrates each instance from the `id` *link value* (the
  logical key) instead of the full URI, so lens-prefix scoping in `getAll`
  filters every instance out — a silent empty result. The generic model stores
  only `data` and recovers the logical id from the base URI's last segment.
- **Browser safety.** The browser path must not pull Node builtins: schemas are
  supplied in memory (`import.meta.glob`), and `subjects/index.js` imports
  `fs/path/url` lazily only on the Node disk-reading branch.
- **Conformance tests are opt-in.** The GUN half of
  `test/backend-conformance.test.js` runs everywhere; the AD4M half runs only
  when `AD4M_TEST_URL` is set and must point at a *disposable* executor (the
  suite creates and deletes perspectives). Boot one with
  `node packages/holosphere/scripts/dev-executor.mjs` (all config via env), then:
  `AD4M_TEST_URL=http://127.0.0.1:<port> AD4M_TEST_TOKEN=<tok> pnpm -F holosphere test -- backend-conformance`.

## When unsure

If a change might violate the local-first / federated / core-owns-meaning
model, stop and ask, or open a draft PR describing the trade-off. Correctness
and architectural integrity beat speed.
