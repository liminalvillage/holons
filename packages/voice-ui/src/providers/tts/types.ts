/** A chunk of synthesized audio (16-bit signed PCM, mono). */
export interface TTSChunk {
  audio: Buffer;
}

/**
 * Text-to-speech provider. Streams PCM16 chunks so playback can start before
 * the whole utterance is synthesized. All providers emit mono PCM16 at
 * `sampleRate` Hz so the browser plays them uniformly.
 */
export interface TTSProvider {
  readonly name: string;
  readonly sampleRate: number;
  synthesize(text: string, signal?: AbortSignal): AsyncGenerator<TTSChunk>;
}
