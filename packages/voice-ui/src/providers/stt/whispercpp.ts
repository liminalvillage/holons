// Local whisper.cpp STT (offline swap). Lazily loads `nodejs-whisper`, which is
// NOT a hard dependency — install it to use STT_PROVIDER=local:
//
//   pnpm --filter @holons/voice-ui add nodejs-whisper
//
// nodejs-whisper transcribes WAV files, so callers must feed 16 kHz mono WAV
// (the browser client encodes WAV; see apps/web).

import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { STTProvider } from './types.js';

export class WhisperCppSTTProvider implements STTProvider {
  readonly name = 'whispercpp';

  constructor(private readonly opts: { model?: string } = {}) {}

  async transcribe(audio: Buffer): Promise<string> {
    let nodewhisper: (path: string, opts: unknown) => Promise<unknown>;
    try {
      // Cast to string so tsc treats this as an unresolved dynamic import
      // (the package is optional and may be absent).
      const mod = (await import(
        /* @vite-ignore */ 'nodejs-whisper' as string
      )) as { nodewhisper: typeof nodewhisper };
      nodewhisper = mod.nodewhisper;
    } catch {
      throw new Error(
        "STT_PROVIDER=local requires 'nodejs-whisper'. Install it with: " +
          'pnpm --filter @holons/voice-ui add nodejs-whisper',
      );
    }

    const dir = await mkdtemp(join(tmpdir(), 'holons-stt-'));
    const wavPath = join(dir, 'utterance.wav');
    try {
      await writeFile(wavPath, audio);
      const result = (await nodewhisper(wavPath, {
        modelName: this.opts.model ?? 'base.en',
        autoDownloadModelName: this.opts.model ?? 'base.en',
        whisperOptions: { outputInText: false },
      })) as string | { speech?: string };
      const text = typeof result === 'string' ? result : (result.speech ?? '');
      return text.replace(/\[[^\]]*\]/g, '').trim();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
