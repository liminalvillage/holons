// Local Kokoro TTS (offline swap) — the same Kokoro model family the Python
// harness runs, via the ONNX port `kokoro-js`. NOT a hard dependency; install
// it to use TTS_PROVIDER=local:
//
//   pnpm --filter @holons/voice-ui add kokoro-js
//
// Emits 24 kHz mono PCM16, matching OpenAITTSProvider.

import type { TTSChunk, TTSProvider } from './types.js';

const CHUNK_SAMPLES = 4096;

interface KokoroRawAudio {
  audio: Float32Array;
  sampling_rate: number;
}
interface KokoroModel {
  generate(text: string, opts: { voice: string }): Promise<KokoroRawAudio>;
}

function floatToPcm16(samples: Float32Array): Buffer {
  const buf = Buffer.allocUnsafe(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE((s < 0 ? s * 0x8000 : s * 0x7fff) | 0, i * 2);
  }
  return buf;
}

export class KokoroTTSProvider implements TTSProvider {
  readonly name = 'kokoro';
  readonly sampleRate = 24000;
  private model: KokoroModel | null = null;

  constructor(
    private readonly opts: { model?: string; voice?: string } = {},
  ) {}

  private async load(): Promise<KokoroModel> {
    if (this.model) return this.model;
    let KokoroTTS: {
      from_pretrained(id: string, opts: unknown): Promise<KokoroModel>;
    };
    try {
      const mod = (await import(/* @vite-ignore */ 'kokoro-js' as string)) as {
        KokoroTTS: typeof KokoroTTS;
      };
      KokoroTTS = mod.KokoroTTS;
    } catch {
      throw new Error(
        "TTS_PROVIDER=local requires 'kokoro-js'. Install it with: " +
          'pnpm --filter @holons/voice-ui add kokoro-js',
      );
    }
    this.model = await KokoroTTS.from_pretrained(
      this.opts.model ?? 'onnx-community/Kokoro-82M-v1.0-ONNX',
      { dtype: 'q8', device: 'cpu' },
    );
    return this.model;
  }

  async *synthesize(text: string, signal?: AbortSignal): AsyncGenerator<TTSChunk> {
    const model = await this.load();
    if (signal?.aborted) return;
    const raw = await model.generate(text, { voice: this.opts.voice ?? 'af_heart' });
    const samples = raw.audio;
    for (let off = 0; off < samples.length; off += CHUNK_SAMPLES) {
      if (signal?.aborted) return;
      const slice = samples.subarray(off, Math.min(off + CHUNK_SAMPLES, samples.length));
      yield { audio: floatToPcm16(slice) };
    }
  }
}
