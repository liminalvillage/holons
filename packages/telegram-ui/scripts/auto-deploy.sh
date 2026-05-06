#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/root/HolonsBot"
NODE_BIN_DIR="/root/.nvm/versions/node/v22.14.0/bin"
PM2_TARGET="HolonsBot"
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
npm install >> "$LOG" 2>&1
pm2 restart "$PM2_TARGET" >> "$LOG" 2>&1
echo "[$(date -Is)] restart complete" >> "$LOG"
