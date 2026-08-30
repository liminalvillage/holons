<!--
Title: use Conventional Commits with a scope, e.g.
  core/scoring: add collaboration signal
  web: fix canvas route
-->

## What & why

<!-- What does this change do, and why is it needed? Link issues: Closes #123 -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / tech debt
- [ ] Documentation
- [ ] Build / CI / tooling

## Scope

- Affected package(s): <!-- @holons/core, holons-web, … -->
- Domain logic changed in `@holons/core`? <!-- yes/no — if a UI changed behavior, it probably belongs in core -->

## Checklist

- [ ] `pnpm -r typecheck` passes
- [ ] `pnpm test` passes (added/updated tests for changed behavior)
- [ ] `pnpm lint` passes
- [ ] No secrets, build output, or `radata/` committed
- [ ] New source files carry the SPDX header
- [ ] Commits are signed off (`git commit -s`) — this accepts the [CLA](../CLA.md)
- [ ] Docs updated if behavior/usage changed

## Screenshots / notes

<!-- For UI changes, before/after screenshots. Anything reviewers should know. -->
