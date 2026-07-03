// OpenAI TTS (API default). Requests raw PCM (24 kHz mono s16le) so the browser
// can play chunks directly via Web Audio without decoding a container.

import OpenAI from 'openai';
import type { TTSChunk, TTSProvider } from './types.js';

const CHUNK_BYTES = 8192; // ~170 ms at 24 kHz s16le

export class OpenAITTSProvider implements TTSProvider {
  readonly name = 'openai';
  readonly sampleRate = 24000;
  private client: OpenAI | null = null;

  constructor(
    private readonly opts: { apiKey?: string; model?: string; voice?: string } = {},
  ) {}

  // Lazy so constructing the provider for the wrong leg never throws on a
  // missing key; the client is created only when we actually synthesize.
  private clientOrThrow(): OpenAI {
    if (!this.client) this.client = new OpenAI({ apiKey: this.opts.apiKey });
    return this.client;
  }

  async *synthesize(text: string, signal?: AbortSignal): AsyncGenerator<TTSChunk> {
    const resp = await this.clientOrThrow().audio.speech.create(
      {
        model: this.opts.model ?? 'tts-1',
        voice: (this.opts.voice ?? 'alloy') as 'alloy',
        input: text,
        response_format: 'pcm',
      },
      { signal },
    );

    const full = Buffer.from(await resp.arrayBuffer());
    for (let off = 0; off < full.length; off += CHUNK_BYTES) {
      if (signal?.aborted) return;
      yield { audio: full.subarray(off, Math.min(off + CHUNK_BYTES, full.length)) };
    }
  }
}
