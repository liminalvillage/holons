# @holons/voice-ui

Near-realtime **voice** adapter for Holons. A browser captures the mic and plays
audio back; a Node service does STT → LLM → Holons MCP tools → TTS. Every leg is
a swappable provider that defaults to a hosted **API** and can switch to fully
**local** inference.

```
Browser (apps/web /voice)                     voice-ui (this package)
  mic → @ricky0123/vad-web ─ WAV ─┐           ┌─ STT  (api: OpenAI Whisper | local: whisper.cpp)
  speaker ← Web Audio  ←──────────┤ WebSocket ├─ LLM  (api: Claude via @holons/ai-ui | local: mlx_lm)
  barge-in on speech-start ───────┘           ├─ TTS  (api: OpenAI tts-1 | local: kokoro-js)
                                              └─ MCP client → @holons/mcp-ui (121 tools) → Gun graph
```

## Provider switch

One master env var selects every leg; per-leg overrides win:

| Env | Values | Default |
|-----|--------|---------|
| `VOICE_PROVIDER` | `api` \| `local` | `api` |
| `LLM_PROVIDER` / `STT_PROVIDER` / `TTS_PROVIDER` | `api` \| `local` | inherit `VOICE_PROVIDER` |

- **api** (default): `ANTHROPIC_API_KEY` (LLM) + `OPENAI_API_KEY` (STT/TTS).
- **local**: `mlx_lm.server` on `LLM_BASE_URL` + optional deps `nodejs-whisper` and `kokoro-js`.

See `.env.example` for the full list. Env is read from the monorepo-root `.env`
and a package-local `.env`.

## Run (API default)

```bash
# 1. Build the MCP server this connects to, and the agent brain.
pnpm -F @holons/mcp-ui build
pnpm -F @holons/ai-ui build

# 2. Configure
cp packages/voice-ui/.env.example packages/voice-ui/.env
#   set ANTHROPIC_API_KEY, OPENAI_API_KEY, HOLONS_ACTOR_*

# 3. Start the voice service (ws://localhost:8787)
pnpm -F @holons/voice-ui build && pnpm -F @holons/voice-ui start
#   dev: pnpm -F @holons/voice-ui dev

# 4. Open the browser front-end
pnpm -F harvest-web dev      # then visit /voice
```

Click **Start talking**, allow the mic, and speak. Talking over the agent
interrupts it (barge-in).

## Run (local swap)

```bash
pnpm --filter @holons/voice-ui add nodejs-whisper kokoro-js   # one-time
# Start an OpenAI-compatible local LLM, e.g. mlx_lm.server --model … --port 1234
VOICE_PROVIDER=local pnpm -F @holons/voice-ui start
```

## Notes / limitations

- **One actor per process**: the MCP subprocess uses a single `HOLONS_ACTOR_*`
  identity shared by all connections. Per-user identity would need a client per
  connection.
- **Stateless per utterance**: each utterance runs a fresh agent turn (no
  conversational memory yet). Threading history across utterances is the next
  step.
- **API latency**: OpenAI Whisper is batch (not streaming), so voice-to-voice is
  higher than the local MLX harness. Streaming STT (or Deepgram) is the lever.
- The pure-local Python harness lives in the separate `holons-voice/` repo; this
  package shares only the `mcp-ui`/`core` layer with it.
