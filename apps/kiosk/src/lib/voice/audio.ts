// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Browser audio helpers for the voice widget (mirrors apps/web/src/lib/voice).
//
// - encodeWav: push-to-talk capture gives us Float32 mono PCM; we wrap it as a
//   16-bit PCM WAV so the server's STT (OpenAI Whisper / whisper.cpp) can read it.
// - PcmPlayer: the server streams 16-bit PCM chunks (24 kHz mono); we schedule
//   them back-to-back via Web Audio and can stop instantly for barge-in.

/** Encode mono Float32 samples as a 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits/sample
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Gapless player for streamed 16-bit PCM chunks; stop() enables barge-in. */
export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private nextTime = 0;
  private sources: AudioBufferSourceNode[] = [];

  constructor(private readonly sampleRate: number) {}

  private context(): AudioContext {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor({ sampleRate: this.sampleRate });
    }
    return this.ctx;
  }

  enqueuePcm16(bytes: Uint8Array): void {
    const ctx = this.context();
    const usable = bytes.length - (bytes.length % 2);
    const int16 = new Int16Array(usable / 2);
    for (let i = 0; i < int16.length; i++) {
      int16[i] = ((bytes[i * 2] | (bytes[i * 2 + 1] << 8)) << 16) >> 16;
    }
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 0x8000;

    const buffer = ctx.createBuffer(1, f32.length, this.sampleRate);
    buffer.getChannelData(0).set(f32);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime, this.nextTime);
    src.start(at);
    this.nextTime = at + buffer.duration;
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src);
    };
    this.sources.push(src);
  }

  stop(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    this.nextTime = 0;
  }
}
