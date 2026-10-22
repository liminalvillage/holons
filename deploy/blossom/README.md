# blossom.holons.io

Every picture in Holons is stored once on a [Blossom](https://github.com/hzrd149/blossom)
server and referenced by URL (`https://blossom.holons.io/<sha256>.jpg`). A Telegram
file_id opens only with the token of the bot that received it; a Blossom URL opens
for every bot, the web, the kiosk and any Nostr client.

- **Writers:** the Telegram bot hosts each photo it receives
  (`packages/telegram-ui/src/Pictures.ts`), the web hosts uploaded task pictures
  (`TaskModal.svelte`). Both go through `uploadBlob` in `@holons/core/media`,
  which signs a BUD-11 kind-24242 authorization scoped to the blob and server.
- **Readers:** every surface renders a stored `picture` with `pictureUrl` from
  `@holons/core/media`. Hosted URLs are used as they are, and old file_ids still go
  through `/api/image` (where `BOT_TOKENS` holds the other bots' tokens).
- **Config:** `MEDIA_SERVERS` (bot, scripts) and `VITE_MEDIA_SERVERS` (web)
  default to `https://blossom.holons.io`. With more than one server listed, the
  first server that accepts the upload stores it.

## Run it

On the relay host:

```sh
cd deploy/blossom
docker compose up -d
curl -s localhost:3000/ | head          # landing page answers
```

Point `blossom.holons.io` at the host. Then proxy it with TLS to `127.0.0.1:3000`, for
example with Caddy:

```
blossom.holons.io {
    reverse_proxy 127.0.0.1:3000
    request_body {
        max_size 20MB
    }
}
```

The server sends `Access-Control-Allow-Origin: *` itself (BUD-01), which the browser
uploads need.

Blobs and the SQLite index live in the `blossom-data` volume, so add it to the relay
backups.

## Check it

```sh
curl -sI https://blossom.holons.io/upload -X HEAD   # 401 without auth = alive
```

Then send a photo with `/task …` to a group. The record's `picture` should be a
`https://blossom.holons.io/…` URL.

## Old pictures

`scripts/rehost-pictures.mjs` copies the Telegram file_ids already in the graph to
Blossom and rewrites each record's `picture`. It dry-runs by default. It needs every
bot's token in `BOT_TOKENS`, because each file_id opens only with its own bot.
