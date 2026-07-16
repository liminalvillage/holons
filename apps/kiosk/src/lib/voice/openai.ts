// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Direct-from-browser OpenAI audio calls for the kiosk's serverless voice
// mode: Whisper for speech-to-text and tts-1 for text-to-speech, both plain
// fetch against api.openai.com (which allows CORS). The key comes from
// VITE_OPENAI_API_KEY — it is inlined into the client bundle, so it is only
// as private as the kiosk device itself; scope/rotate it accordingly.

const API_BASE = "https://api.openai.com/v1";

/** PCM sample rate `response_format: "pcm"` streams at (16-bit mono). */
export const TTS_PCM_SAMPLE_RATE = 24000;

export interface OpenAIVoiceOptions {
  apiKey: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
}

/** Transcribe one WAV utterance via the audio/transcriptions endpoint. */
export async function transcribe(
  wav: Uint8Array,
  opts: OpenAIVoiceOptions,
  signal: AbortSignal,
): Promise<string> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" }),
    "utterance.wav",
  );
  form.append("model", opts.sttModel);
  const resp = await fetch(`${API_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}` },
    body: form,
    signal,
  });
  if (!resp.ok) {
    throw new Error(
      `STT HTTP ${resp.status}: ${await resp.text().catch(() => "")}`,
    );
  }
  const data = (await resp.json()) as { text?: string };
  return (data.text ?? "").trim();
}

/**
 * Synthesize speech as a stream of raw 16-bit 24 kHz mono PCM chunks —
 * exactly what the widget's PcmPlayer plays, so chunks go straight from the
 * network to the speaker with no container parsing.
 */
export async function* synthesizeSpeech(
  text: string,
  opts: OpenAIVoiceOptions,
  signal: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const resp = await fetch(`${API_BASE}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.ttsModel,
      voice: opts.ttsVoice,
      input: text,
      response_format: "pcm",
    }),
    signal,
  });
  if (!resp.ok || !resp.body) {
    throw new Error(
      `TTS HTTP ${resp.status}: ${await resp.text().catch(() => "")}`,
    );
  }
  const reader = resp.body.getReader();
  // PCM frames are 2 bytes; a network chunk can split one — carry the odd
  // byte into the next chunk so the player never sees a torn sample.
  let carry: Uint8Array | null = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;
      let chunk = value;
      if (carry) {
        const joined = new Uint8Array(carry.length + chunk.length);
        joined.set(carry, 0);
        joined.set(chunk, carry.length);
        chunk = joined;
        carry = null;
      }
      if (chunk.length % 2 === 1) {
        carry = chunk.slice(chunk.length - 1);
        chunk = chunk.subarray(0, chunk.length - 1);
      }
      if (chunk.length > 0) yield chunk;
    }
  } finally {
    reader.releaseLock();
  }
}
