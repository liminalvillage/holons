# @holons/mcp-ui

MCP server exposing every `@holons/core` function as an independently-callable tool. Replaces the legacy `telegram-ui` HTTP bot API (port 3101) and the duplicate MCP wrappers in `telegram-ui/mcp`.

## Usage

```bash
pnpm -F @holons/mcp-ui build

# stdio (default)
node packages/mcp-ui/dist/index.js

# SSE on a port
node packages/mcp-ui/dist/index.js --port 3200
```

## Env

- `HOLOSPHERE_RELAYS` — comma-separated Nostr relay URLs, the wire (default `wss://relay.holons.io,wss://relay.commonshub.dev`)
- `HOLOSPHERE_NSEC` — Nostr secret key (`nsec1…` or hex) that signs the server's writes (a throwaway key is generated when unset)
- `HOLOSPHERE_STORE_DIR` — directory for a persistent file-backed local store (default: in memory, re-synced per process)
- `HOLOSPHERE_PROJECTIONS` — standard-kind projections, on for every lens by default (`off` | comma list)
- `HOLONS_APP` — HoloSphere app name (default `Holons`)
- `HOLONS_ACTOR_ID` — default acting user id for write tools
- `HOLONS_ACTOR_NAME` — default acting user display name
- `HOLONS_ACTOR_USERNAME` — default acting user @handle

## Tool catalog

One file per `@holons/core` domain under `src/tools/`. Each tool maps 1:1 to a public exported function.
