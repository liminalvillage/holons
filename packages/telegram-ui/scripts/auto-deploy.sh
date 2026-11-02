#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/root/holons"
NODE_BIN_DIR="/root/.nvm/versions/node/v22.14.0/bin"
PM2_TARGETS=(HolonsBot HubsNetworkBot ReGenerativaBot)
LOG="/var/log/holonsbot-autodeploy.log"
LOCK="/var/lock/holonsbot-autodeploy.lock"

export PATH="$NODE_BIN_DIR:$PATH"

exec 9>"$LOCK"
flock -n 9 || exit 0

cd "$REPO_DIR"

git fetch --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse '@{u}')

if [ "$LOCAL" = "$REMOTE" ]; then
    exit 0
fi

echo "[$(date -Is)] update detected: $LOCAL -> $REMOTE" >> "$LOG"
git pull --ff-only >> "$LOG" 2>&1
pnpm install --frozen-lockfile >> "$LOG" 2>&1
# Node resolves @holons/core/* to dist/, so the bots run stale code (or fail on
# a missing export) unless core is rebuilt before they restart.
pnpm -F @holons/core build >> "$LOG" 2>&1
pm2 restart "${PM2_TARGETS[@]}" >> "$LOG" 2>&1
echo "[$(date -Is)] restart complete" >> "$LOG"
