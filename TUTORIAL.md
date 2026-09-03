# Tutorial: run the stack and make your first change

This walks you from a clean clone to a tested change visible in a UI. Budget
~30 minutes. Prerequisites: Node ≥ 20, pnpm ≥ 10.

## Step 1 — Clone and verify

```bash
git clone https://github.com/HolonicLabs/holons.git
cd holons
pnpm install
pnpm -r typecheck      # ✅ everything typechecks
pnpm test              # ✅ vitest suites pass
```

If those two are green, your environment is correct.

## Step 2 — Run the web UI

```bash
cp apps/web/.env.example apps/web/.env
pnpm dev
```

Open <http://localhost:5173>. You're looking at `holons-web` reading from a
Holosphere namespace. No keys are required just to boot the UI; features
like maps need their token (`VITE_MAPBOX_TOKEN`) in `apps/web/.env`.

## Step 3 — Find the logic, not the pixels

Behavior lives in `@holons/core`, never in a UI. Explore the domains:

```bash
ls packages/core/src
# scoring  tasks  expenses  federation  users  calendar
# library  checklists  shopping  settings  dna  categories  commands  rea ...
```

Pick one — say `scoring`. Read `packages/core/src/scoring/index.ts` and its
test `packages/core/src/scoring/*.test.ts`. Notice the UI never recomputes a
score; it calls core.

## Step 4 — Make a change (test-first)

We'll add a trivial, safe helper to a domain to learn the loop. Example:
a `packages/core/src/scoring/scoring.tutorial.test.ts` that asserts an existing
exported function's behavior, then a one-line doc/util addition.

1. Create a branch:
   ```bash
   git checkout -b feat/scoring-tutorial
   ```
2. Add a focused `vitest` spec next to the domain
   (`packages/core/src/scoring/<something>.test.ts`) covering the behavior you
   intend to add or document.
3. Run just that package's tests in watch mode:
   ```bash
   pnpm -F @holons/core test -- --watch
   ```
4. Implement the minimal change in the domain's `index.ts` (or a sibling file
   it exports). Keep `@holons/core` free of any UI import.
5. Add the SPDX header to any new file:
   ```ts
   // SPDX-License-Identifier: AGPL-3.0-or-later
   // SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
   ```

## Step 5 — See it through a UI

Because every UI calls the same core function, your change shows up everywhere.
The fastest way to observe it without a browser:

```bash
pnpm -F @holons/text-ui build
pnpm -F @holons/text-ui exec holons --help
# then run a command that exercises the domain you changed
```

(Or keep `pnpm dev` running and use the relevant screen in the web UI.)

## Step 6 — Gate, commit, PR

```bash
pnpm -r typecheck && pnpm test && pnpm lint   # all green
git add -A
git commit -s -m "core/scoring: <what you changed>"
git push -u origin feat/scoring-tutorial
```

`-s` adds your `Signed-off-by:` line, which records acceptance of the
[CLA](./CLA.md). Open a pull request against `main` using the template and
fill in *what* and *why*.

## What you just learned

- **Core-first:** change meaning in `@holons/core`, presentation in the UI.
- **Test-first:** every domain change ships with a `vitest` spec.
- **One gate:** `typecheck`, `test`, `lint` must pass from a clean clone.
- **One data layer:** Holosphere (signed events on relays) is the source of truth; UIs are renderers.

Next: skim [`docs/architecture.md`](./docs/architecture.md) for the full
picture, and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for conventions.
