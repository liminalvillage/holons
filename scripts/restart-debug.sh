#!/usr/bin/env bash
# Restart bot + web + mcp in debug mode.
# - Kills any running tsx-watch HolonsBot and vite-dev processes
# - Rebuilds packages/mcp-ui (the MCP runtime)
# - Relaunches the bot and web dev server in the background, logging to /tmp
# - Prints the next manual step (/mcp reconnect) since Claude Code, not the
#   shell, owns the MCP server lifecycle

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BOT_LOG=/tmp/holons-bot.log
WEB_LOG=/tmp/holons-web.log

color() { printf "\033[1;36m%s\033[0m\n" "$*"; }
warn()  { printf "\033[1;33m%s\033[0m\n" "$*"; }

color "→ Killing existing bot + vite processes"
pkill -f "tsx watch .*HolonsBot.js"      2>/dev/null || true
pkill -f "vite.js dev"                   2>/dev/null || true
pkill -f "packages/mcp-ui/dist/index.js" 2>/dev/null || true
sleep 1

color "→ Rebuilding @holons/mcp-ui"
pnpm --filter @holons/mcp-ui build

color "→ Starting bot (logs: $BOT_LOG)"
: > "$BOT_LOG"
nohup pnpm dev:bot > "$BOT_LOG" 2>&1 &
BOT_PID=$!
disown $BOT_PID

color "→ Starting web dev (logs: $WEB_LOG)"
: > "$WEB_LOG"
nohup pnpm dev    > "$WEB_LOG" 2>&1 &
WEB_PID=$!
disown $WEB_PID

sleep 2

printf "\n"
color "✓ Restarted"
printf "  bot pid: %s   tail -f %s\n" "$BOT_PID" "$BOT_LOG"
printf "  web pid: %s   tail -f %s   →  http://127.0.0.1:5173\n" "$WEB_PID" "$WEB_LOG"

printf "\n"
warn  "Next: type /mcp in Claude Code to reconnect the holons MCP."
warn  "(Claude Code owns the MCP process; this script can't restart it for you.)"
