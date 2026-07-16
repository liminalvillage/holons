// SPDX-License-Identifier: AGPL-3.0-or-later
//
// WebSocket voice backend — the original transport: a @holons/voice-ui
// server (local machine or self-hosted) owns STT → agent → TTS and this
// class just ferries frames. Probes the server with exponential backoff so
// kiosks without one go quiet instead of spamming the console every 30s.

import { bytesToBase64, base64ToBytes } from "$lib/voice/audio";
import type {
  BackendEvent,
  VoiceBackend,
  VoiceContext,
} from "$lib/voice/backend";

const RETRY_MIN_MS = 30_000;
const RETRY_MAX_MS = 600_000;

export class WsVoiceBackend implements VoiceBackend {
  private ws: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = RETRY_MIN_MS;
  private destroyed = false;
  private onEvent: (ev: BackendEvent) => void = () => {};

  constructor(private readonly url: string) {}

  start(onEvent: (ev: BackendEvent) => void): void {
    this.onEvent = onEvent;
    this.destroyed = false;
    this.connect();
  }

  stop(): void {
    this.destroyed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    if (this.destroyed || this.ws) return;
    let sock: WebSocket;
    try {
      sock = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    sock.onmessage = (ev) => this.onFrame(ev);
    sock.onopen = () => {
      this.ws = sock;
      this.retryDelay = RETRY_MIN_MS;
    };
    sock.onerror = () => {
      /* onclose follows; retry is scheduled there */
    };
    sock.onclose = () => {
      if (this.ws === sock) this.ws = null;
      if (!this.destroyed) {
        this.onEvent({ type: "down" });
        this.scheduleRetry();
      }
    };
  }

  private scheduleRetry(): void {
    if (this.destroyed || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
  }

  private onFrame(ev: MessageEvent): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    switch (msg.type) {
      case "ready":
        this.onEvent({
          type: "ready",
          sampleRate: Number(msg.sampleRate) || 24000,
        });
        break;
      case "transcript":
        this.onEvent({ type: "transcript", text: String(msg.text) });
        break;
      case "tool":
        this.onEvent({ type: "tool", name: String(msg.name) });
        break;
      case "assistant":
        this.onEvent({ type: "assistant", text: String(msg.text) });
        break;
      case "tts_start":
        this.onEvent({ type: "tts_start" });
        break;
      case "tts":
        this.onEvent({
          type: "tts_pcm",
          pcm: base64ToBytes(String(msg.audio)),
        });
        break;
      case "tts_end":
        this.onEvent({ type: "tts_end" });
        break;
      case "navigate":
        this.onEvent({ type: "navigate", view: String(msg.view ?? "") });
        break;
      case "error":
        this.onEvent({ type: "error", message: String(msg.message) });
        break;
    }
  }

  private send(obj: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify(obj));
  }

  utterance(wav: Uint8Array, context: VoiceContext): void {
    this.send({
      type: "utterance",
      mime: "audio/wav",
      audio: bytesToBase64(wav),
      context,
    });
  }

  text(text: string, context: VoiceContext): void {
    this.send({ type: "text", text, context });
  }

  bargeIn(): void {
    this.send({ type: "barge_in" });
  }

  setMuted(muted: boolean): void {
    this.send({ type: "mute", muted });
  }

  context(context: VoiceContext): void {
    this.send({ type: "context", context });
  }
}
