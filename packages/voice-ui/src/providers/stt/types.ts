/** Speech-to-text provider: one utterance of audio → transcript text. */
export interface STTProvider {
  readonly name: string;
  /**
   * Transcribe a complete utterance.
   * @param audio  Encoded audio bytes (wav/webm/mp3 — provider-dependent).
   * @param mime   MIME type hint for the container (default audio/wav).
   */
  transcribe(audio: Buffer, mime?: string): Promise<string>;
}
