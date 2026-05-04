#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/root/HolonsBot"
PM2_BIN="/root/.nvm/versions/node/v22.14.0/bin/pm2"
NPM_BIN="/root/.nvm/versions/node/v22.14.0/bin/npm"
PM2_TARGET="0"
LOG="/var/log/holonsbot-autodeploy.log"

cd "$REPO_DIR"

git fetch --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse '@{u}')

if [ "$LOCAL" = "$REMOTE" ]; then
    exit 0
fi

echo "[$(date -Is)] update detected: $LOCAL -> $REMOTE" >> "$LOG"
git pull --ff-only >> "$LOG" 2>&1
"$NPM_BIN" install >> "$LOG" 2>&1
"$PM2_BIN" restart "$PM2_TARGET" >> "$LOG" 2>&1
echo "[$(date -Is)] restart complete" >> "$LOG"
