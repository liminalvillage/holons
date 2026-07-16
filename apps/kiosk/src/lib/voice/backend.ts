// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The seam between the voice controller (mic, speaker, widget state) and
// whatever runs the STT → agent → TTS pipeline. Two implementations:
//   ws.ts     — the @holons/voice-ui WebSocket server (local or self-hosted)
//   direct.ts — straight from the browser to the OpenAI API, serverless
// Events mirror the voice-ui wire protocol, with TTS audio already decoded
// to raw PCM bytes so the controller feeds one player either way.

export type VoiceContext = Record<string, string>;

export type BackendEvent =
  | { type: "ready"; sampleRate: number }
  | { type: "down" } // connection lost / backend unavailable
  | { type: "transcript"; text: string }
  | { type: "tool"; name: string }
  | { type: "assistant"; text: string }
  | { type: "tts_start" }
  | { type: "tts_pcm"; pcm: Uint8Array }
  | { type: "tts_end" }
  | { type: "navigate"; view: string }
  | { type: "error"; message: string };

export interface VoiceBackend {
  /** Begin (re)establishing availability; events flow to `onEvent`. */
  start(onEvent: (ev: BackendEvent) => void): void;
  /** Tear down sockets/turns; no events fire after this. */
  stop(): void;
  /** One complete spoken utterance (16-bit PCM WAV). */
  utterance(wav: Uint8Array, context: VoiceContext): void;
  /** Typed text through the same agent pipeline (STT skipped). */
  text(text: string, context: VoiceContext): void;
  /** Cancel the in-flight turn's output (user started talking / dismissed). */
  bargeIn(): void;
  /** True: skip TTS synthesis entirely (text frames keep flowing). */
  setMuted(muted: boolean): void;
  /** Announce where the UI is so the backend can pre-warm data. */
  context(context: VoiceContext): void;
}
