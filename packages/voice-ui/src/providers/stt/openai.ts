// OpenAI Whisper STT (API default).

import OpenAI, { toFile } from 'openai';
import type { STTProvider } from './types.js';

function extFor(mime: string): string {
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp3') || mime.includes('mpeg')) return 'mp3';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  return 'wav';
}

export class OpenAISTTProvider implements STTProvider {
  readonly name = 'openai';
  private client: OpenAI | null = null;

  constructor(
    private readonly opts: { apiKey?: string; model?: string } = {},
  ) {}

  // Lazy so constructing the provider (e.g. for the wrong leg) never throws on
  // a missing key; the client is only created when we actually transcribe.
  private clientOrThrow(): OpenAI {
    if (!this.client) this.client = new OpenAI({ apiKey: this.opts.apiKey });
    return this.client;
  }

  async transcribe(audio: Buffer, mime = 'audio/wav'): Promise<string> {
    const file = await toFile(audio, `utterance.${extFor(mime)}`, { type: mime });
    const res = await this.clientOrThrow().audio.transcriptions.create({
      file,
      model: this.opts.model ?? 'whisper-1',
    });
    return res.text.trim();
  }
}
