#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Build @holons/core + WeQuest and deploy to Netlify.
#
#   ./deploy.sh            # deploy a draft preview (returns a preview URL)
#   ./deploy.sh --prod     # deploy to production
#
# Requires the Netlify CLI (fetched via npx) and a linked site — run
# `npx netlify-cli link` once in this directory, or set NETLIFY_SITE_ID /
# NETLIFY_AUTH_TOKEN in the environment (e.g. for CI).
set -euo pipefail

# Repo root, regardless of where this is invoked from.
cd "$(dirname "$0")/../.."

echo "▸ Building @holons/core (apps consume the compiled dist)…"
pnpm -F @holons/core build

echo "▸ Building WeQuest…"
pnpm -F wequest build

echo "▸ Deploying apps/wequest to Netlify…"
cd apps/wequest
npx -y netlify-cli deploy "$@"
