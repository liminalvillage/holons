#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Pre-deploy gate + deploy for WeQuest.
#
# Deploys go through the Netlify GIT INTEGRATION — a push to the linked
# branch triggers the build defined in netlify.toml. A local
# `netlify-cli deploy` of a prebuilt directory does NOT work for this app:
# its function bundler downgrades to CJS and rejects holosphere's `ws`
# import and SvelteKit's top-level await (see the NOTE in netlify.toml).
#
#   ./deploy.sh          # build + verify only (the safe default)
#   ./deploy.sh --push   # build + verify, then push the current branch
set -euo pipefail

# Repo root, regardless of where this is invoked from.
cd "$(dirname "$0")/../.."

echo "▸ Building @holons/core (apps consume the compiled dist)…"
pnpm -F @holons/core build

echo "▸ Verifying WeQuest (typecheck + tests + build)…"
pnpm -F wequest typecheck
pnpm -F wequest test
pnpm -F wequest build

if [[ "${1:-}" == "--push" ]]; then
  branch="$(git rev-parse --abbrev-ref HEAD)"
  echo "▸ Pushing ${branch} — Netlify builds from the linked branch."
  git push origin "${branch}"
else
  echo "✓ Build verified. Deploy by pushing the linked branch (or rerun with --push)."
fi
