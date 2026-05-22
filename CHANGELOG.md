# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/).
The repository is a monorepo; individual packages carry their own versions in
their `package.json`.

## [Unreleased]

### Added

- Dual-licensing: `LICENSE.md` (AGPL-3.0-or-later), `LICENSE-COMMERCIAL.md`,
  `LICENSING.md`, and a Contributor License Agreement (`CLA.md`).
- Project governance & onboarding: rewritten `README.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`, `ONBOARDING.md`, `TUTORIAL.md`, and a
  monorepo-accurate `CLAUDE.md`.
- GitHub issue/PR templates and a CI workflow (install, typecheck, build, test).
- Consolidated `docs/`: a documentation index, an accurate architecture
  document, and a single real-time sync document.

### Changed

- Normalized the `license` field across every `package.json` to the SPDX
  expression `AGPL-3.0-or-later` (previously a mix of `AGPL`, `GPL-3.0-only`,
  and missing fields).
- `pnpm-lock.yaml` is now committed for reproducible installs and CI; `.gitignore`
  was rewritten and grouped by purpose.

### Removed

- Collapsed ~12 redundant WebSocket/realtime/notifications scratch documents
  into one accurate `docs/realtime-sync.md`.
- Dev-only tooling and scratch artifacts that do not serve published consumers.

### Security

- Removed a Personal Access Token that had been embedded in the git remote URL.
  **The exposed token must be revoked and rotated by the maintainer** — see
  [`SECURITY.md`](./SECURITY.md).

---

## Package baselines

At the time of the cleanup the packages were at:

- `@holons/core` — 0.1.0
- `@holons/ai-ui` — 0.1.0
- `@holons/text-ui` — 0.1.0
- `@holons/mcp-ui` — 0.1.0
- `@holons/telegram-ui` — 2.0.0
- `harvest-web` — 2.0.0

[Unreleased]: https://github.com/HolonicLabs/holons/commits/main
