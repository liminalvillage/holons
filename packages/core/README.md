# @holons/core

UI-agnostic domain logic for Holons. Every interface — `harvest-web`,
`@holons/telegram-ui`, `@holons/text-ui`, `@holons/ai-ui`, `@holons/mcp-ui` —
calls into this package so that an action means the same thing everywhere.

> **Rule:** behavior lives here; presentation lives in the UIs. `@holons/core`
> must not import a UI framework (`svelte`, `telegraf`, …). Type-only imports
> are fine.

## Install / use (within the monorepo)

Depend on it with `"@holons/core": "workspace:*"` and import per domain via
**subpath imports** — there is intentionally no cross-domain barrel:

```ts
import { calculateUserScore } from '@holons/core/scoring';
import { createTask }  from '@holons/core/tasks';
import { tallyVotes }        from '@holons/core/council';
```

Each domain's public API is its `src/<domain>/index.ts`. The package's wildcard
subpath export makes new domains importable without editing a central file.

## Domains

| Domain | Responsibility |
| --- | --- |
| `scoring` | Contribution scoring: value equations, REA aggregation, per-user scores. |
| `tasks` | Quest/task types, creation, persistence, lifecycle. |
| `council` | Proposal lifecycle, voting tally, consensus (no LLM logic). |
| `expenses` | Balance accounting, currency normalization, credit matrix. |
| `federation` | UI-agnostic publishing/identity/relay routing between holons. |
| `holosphere` | The single Holosphere I/O factory + identity-aware read/write. |
| `users` | Profiles, values/needs, holon membership. |
| `calendar` | RSVP tracking, iCal feed generation. |
| `library` | Community library: borrow/lend CRUD, deposit accounting. |
| `checklists` | Checklist/subtask CRUD shared across UIs. |
| `shopping` | Shopping-list CRUD. |
| `settings` | Holon settings, flow settings, federation-link helpers. |
| `dna` | Holon DNA: chromosomes, sequences, values/tools/practices library. |
| `categories` | Shared category → color palette. |
| `commands` | Abstract command/intent registry + dispatch for CLI/AI/text UIs. |
| `rea` | REA event store/factory capturing user actions for scoring. |

## Scripts

```bash
pnpm -F @holons/core typecheck   # tsc --noEmit
pnpm -F @holons/core build       # tsc → dist/
pnpm -F @holons/core test        # vitest (specs live next to each domain)
```

No environment variables are required: Holosphere configuration is supplied by
the calling UI and passed into the `holosphere` factory.

## Conventions

- Add a domain: create `src/<domain>/index.ts`, export its API, add
  `src/<domain>/<domain>.test.ts`. No central registry to touch.
- New files carry the SPDX header
  (`AGPL-3.0-or-later`; see [`../../LICENSING.md`](../../LICENSING.md)).
- Keep the layer pure: no UI, no global singletons; the Holosphere factory is
  the one I/O seam.

See [`../../docs/architecture.md`](../../docs/architecture.md) for the full
picture and [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) for workflow.
