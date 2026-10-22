# CLAUDE.md

Guidance for AI coding agents (and humans) working in this repository. It
supersedes the old single-repo `VIBE.md`/`docs/CLAUDE.md` constitution, which
described a pre-monorepo layout.

## What this repository is

A **pnpm monorepo** for Holons — agent-centric, federated group coordination.
One UI-agnostic domain core, five interfaces over it.

```
apps/web/              holons-web — Svelte 5 / SvelteKit dashboard
packages/core/         @holons/core — ALL domain logic (TypeScript)
packages/telegram-ui/  Telegraf bot (mixed JS+TS, migrating)
packages/text-ui/      CLI / REPL
packages/ai-ui/        Claude tool-use NL interface
packages/mcp-ui/       Model Context Protocol server
```

Data layer: **Holosphere** — signed Nostr events (kind 30078) on relays,
mirrored into a local event-sourced store; namespaced per holon and
local-first. See `packages/holosphere/STORE.md`.

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
- Clean up Holosphere subscriptions and timers; assume async, eventual
  consistency — don't force synchronous reads.
- Keep the working tree clean: no `build/`, `.svelte-kit/`, `holosphere-store/`, or
  `.env` in commits.
- Conventional Commits with a scope: `core/scoring: …`, `web: …`, `docs: …`.

## When unsure

If a change might violate the local-first / federated / core-owns-meaning
model, stop and ask, or open a draft PR describing the trade-off. Correctness
and architectural integrity beat speed.
