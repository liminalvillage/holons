#!/usr/bin/env node
// @holons/voice-ui entry point — boots the WebSocket voice server.
//
// Config comes from env (see .env.example). VOICE_PROVIDER=api (default) runs
// against hosted models; VOICE_PROVIDER=local swaps in mlx_lm.server +
// whisper.cpp + kokoro-js. The Holons MCP tools are the same in both modes.

import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { startVoiceServer } from './server.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
loadDotenv({ path: resolve(REPO_ROOT, '.env'), quiet: true });
loadDotenv({ quiet: true }); // also pick up a package-local .env if present

export { loadConfig } from './config.js';
export { startVoiceServer, type VoiceServer } from './server.js';
export { makeLLM, makeSTT, makeTTS } from './factory.js';
export { connectHolonsMcp, type HolonsMcp } from './mcp-client.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // Fail fast on the credential the active API leg needs.
  if (config.llm === 'api' && !config.anthropicApiKey) {
    throw new Error('LLM leg is "api" but ANTHROPIC_API_KEY is not set.');
  }
  if ((config.stt === 'api' || config.tts === 'api') && !config.openaiApiKey) {
    throw new Error('STT/TTS leg is "api" but OPENAI_API_KEY is not set.');
  }

  const server = await startVoiceServer(config);
  console.error(
    `[holons-voice] ws://localhost:${server.port} — ` +
      `llm=${config.llm} stt=${config.stt} tts=${config.tts}`,
  );

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      void server.close().finally(() => process.exit(0));
    });
  }
}

// Run only when invoked directly (not when imported for its exports).
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((err) => {
    console.error(`[holons-voice] fatal:`, err);
    process.exit(1);
  });
}
