#!/usr/bin/env bash
# One-shot: start an open strfry relay, run the round-trip, restart strfry,
# and prove the event survived the restart. Requires Docker + node deps installed.
set -euo pipefail
NAME=strfry-spike
DIR="$(cd "$(dirname "$0")" && pwd)"

wait_up() { for _ in $(seq 1 30); do curl -s -m2 http://127.0.0.1:7777 -H "Accept: application/nostr+json" >/dev/null 2>&1 && return 0; sleep 1; done; echo "strfry did not come up"; exit 1; }

echo "=== starting strfry (open relay, persistent volume) ==="
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker volume create strfry-spike-db >/dev/null
docker run -d --name "$NAME" -p 7777:7777 \
  -v strfry-spike-db:/app/strfry-db \
  -v "$DIR/strfry.conf:/etc/strfry.conf:ro" \
  dockurr/strfry >/dev/null
wait_up

node "$DIR/roundtrip-strfry.mjs"

echo "=== restarting strfry (process death) to test durability ==="
docker restart "$NAME" >/dev/null
wait_up
node "$DIR/relay-fetch.mjs"

echo "=== teardown: docker rm -f $NAME && docker volume rm strfry-spike-db ==="
