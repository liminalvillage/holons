# Contributing to Holons

Thanks for considering a contribution! This guide gets you from a clone to a
merged pull request.

By contributing you agree to the **[Contributor License Agreement](./CLA.md)**
and the **[Code of Conduct](./CODE_OF_CONDUCT.md)**. The CLA is what keeps
Holons [dual-licensed](./LICENSING.md) — please read it before your first PR.

## 1. Development setup

Requires **Node ≥ 20** and **pnpm ≥ 10** (`corepack enable` gives you pnpm).

```bash
git clone https://github.com/HolonicLabs/holons.git
cd holons
pnpm install                # installs the whole workspace from the committed lockfile
pnpm -r typecheck           # everything should typecheck on a clean clone
pnpm test                   # vitest across all packages
```

Copy the env template for whatever you're running and fill in only the keys you
need:

```bash
cp apps/web/.env.example apps/web/.env
cp packages/telegram-ui/.env.example packages/telegram-ui/.env
```

Never commit `.env`, `.mcp.json`, or any secret — they are gitignored on
purpose. If you add a new variable, document it in the matching `.env.example`.

## 2. Project layout

It's a pnpm monorepo. `@holons/core` is the UI-agnostic domain layer; every UI
(`apps/web`, `packages/{telegram,text,ai,mcp}-ui`) calls into it and must not
re-implement domain rules. See [`docs/architecture.md`](./docs/architecture.md).

Useful workspace commands:

```bash
pnpm -F @holons/core test           # one package's tests
pnpm -F harvest-web dev             # run just the web app
pnpm -r --if-present build          # build everything
```

## 3. Branching & commits

- Branch from `main`: `feat/<short-topic>`, `fix/<short-topic>`, `docs/<topic>`.
- Use **[Conventional Commits](https://www.conventionalcommits.org/)** with a
  scope, matching the existing history:
  `core/scoring: add collaboration signal`,
  `web: fix canvas route`, `docs: add tutorial`.
- Keep commits focused and the working tree clean (no build output, no
  `radata/`, no `.env`).
- **Sign off every commit**: `git commit -s` adds the
  `Signed-off-by: Name <email>` line. The sign-off also records your acceptance
  of the [CLA](./CLA.md). A CLA-assistant check may run on your first PR.

## 4. Code style & conventions

- **TypeScript everywhere** in `@holons/core` and the newer UIs. The Telegram
  bot is mixed JS+TS (migrating); follow the style of the file you touch.
- **Subpath imports** — `import { calculateUserScore } from '@holons/core/scoring'`.
  No cross-domain barrel re-exports. Each domain lives at
  `packages/core/src/<domain>/index.ts`.
- **Core stays UI-free** — `@holons/core` must not import `svelte`, `telegraf`,
  etc. (type-only imports are fine).
- **One Holosphere factory** — all identity-aware reads/writes go through
  `@holons/core/holosphere`. Don't `new HoloSphere()` in a UI.
- **SPDX header** on new source files:
  ```ts
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
  ```
- Run `pnpm format` and `pnpm lint` before pushing.

### Adding a shared domain to `@holons/core`

1. Create `packages/core/src/<domain>/index.ts` (+ implementation files).
2. Export the public API from that `index.ts` — the package's wildcard subpath
   export picks it up automatically; no central barrel to edit.
3. Add a `vitest` spec next to it: `<domain>/<domain>.test.ts`.
4. Add any new dependency to `packages/core/package.json`.

### Adding a new UI

1. `mkdir -p packages/<my-ui>/src`.
2. Copy `packages/text-ui/{package.json,tsconfig.json}` as a starting point;
   update `name`/`bin`.
3. Depend on core via `"@holons/core": "workspace:*"`.
4. `pnpm install` from the repo root.
5. Build the renderer/parser against `@holons/core/commands` so every UI
   triggers the same actions.

## 5. Tests & required checks

A PR is mergeable when, from a clean clone:

```bash
pnpm -r typecheck   # ✅ no type errors
pnpm test           # ✅ vitest green
pnpm lint           # ✅ lint clean
```

Add or update tests for any behavior you change. Domain logic in
`@holons/core` should have a `vitest` spec.

## 6. Pull requests

1. Open against `main` with a clear title (Conventional Commit style) and a
   description of *what* and *why*.
2. Link related issues; include screenshots for UI changes.
3. Ensure the checks in §5 pass and commits are signed off.
4. Keep PRs reviewable — split unrelated changes.
5. A maintainer reviews; address feedback by pushing follow-up commits.

## 7. Reporting bugs & proposing features

Use the [issue templates](./.github/ISSUE_TEMPLATE). For security issues, do
**not** open an issue — follow [SECURITY.md](./SECURITY.md).

Questions are welcome — open a discussion or a draft PR early. Thank you for
helping the commons. 🌱
