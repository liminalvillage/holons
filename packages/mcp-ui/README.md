# @holons/mcp-ui

MCP server exposing every `@holons/core` function as an independently-callable tool. Replaces the legacy `telegram-ui` HTTP bot API (port 3101) and the duplicate MCP wrappers in `telegram-ui/mcp`.

## Usage

```bash
pnpm -F @holons/mcp-ui build
node packages/mcp-ui/dist/index.js                 # stdio
node packages/mcp-ui/dist/index.js --port 3200     # SSE
```

## Env

- `HOLONS_PEER` — Gun peer URL (default `https://gun.holons.io/gun`)
- `HOLONS_APP` — HoloSphere app name (default `Holons`)
- `HOLONS_ACTOR_ID` / `HOLONS_ACTOR_NAME` / `HOLONS_ACTOR_USERNAME` — default acting user
