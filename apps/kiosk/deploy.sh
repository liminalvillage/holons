#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Build @holons/core + the kiosk and deploy the static site to Netlify.
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

echo "▸ Building @holons/core + @holons/ai-ui (apps consume the compiled dist)…"
pnpm -F @holons/core build
pnpm -F @holons/ai-ui build

echo "▸ Building the kiosk…"
pnpm -F kiosk build

echo "▸ Deploying apps/kiosk/build to Netlify…"
npx -y netlify-cli deploy --dir apps/kiosk/build "$@"
