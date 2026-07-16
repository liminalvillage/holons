// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Voice session controller — one backend shared by the inline VoiceButtons
// (rendered in each view's fab row) and the VoiceWidget overlay (bubble +
// type panel). The controller owns the mic, the speaker, and the widget
// state; the pipeline itself runs behind the VoiceBackend seam:
//
//   ws     — a @holons/voice-ui server (local/self-hosted), the original mode
//   direct — straight from the browser to the OpenAI API (Whisper/GPT/tts-1),
//            for kiosks deployed with no companion server
//
// Selection: VITE_VOICE_MODE=ws|direct wins; otherwise an explicit
// VITE_VOICE_WS_URL keeps ws, else a baked-in VITE_OPENAI_API_KEY enables
// direct, else ws probes localhost. When neither is reachable/configured the
// buttons render nothing.

import { get, writable } from "svelte/store";
import {
  activeTab,
  holonId,
  holonName,
  selection,
  selectTab,
  visibleTabs,
  type Selection,
} from "$lib/stores";
import { encodeWav, PcmPlayer } from "$lib/voice/audio";
import type {
  BackendEvent,
  VoiceBackend,
  VoiceContext,
} from "$lib/voice/backend";
import { WsVoiceBackend } from "$lib/voice/ws";
import { DirectVoiceBackend, hasDirectVoiceKey } from "$lib/voice/direct";

const WS_URL_ENV = import.meta.env.VITE_VOICE_WS_URL as string | undefined;
const MODE_ENV = (import.meta.env.VITE_VOICE_MODE as string | undefined)
  ?.trim()
  .toLowerCase();

/**
 * Which pipeline to talk to. Resolved on every (re)init, not once at module
 * load, because direct availability depends on the caretaker's device-local
 * key (Settings) which can appear or vanish while the app runs.
 */
function resolveVoiceMode(): "ws" | "direct" {
  if (MODE_ENV === "ws" || MODE_ENV === "direct") return MODE_ENV;
  if (WS_URL_ENV) return "ws";
  return hasDirectVoiceKey() ? "direct" : "ws";
}

/** How long the reply bubble lingers after the agent finishes speaking. */
const BUBBLE_LINGER_MS = 8_000;

export const available = writable(false);
export const status = writable<"ready" | "recording" | "thinking" | "speaking">(
  "ready",
);
/** Spoken replies off — the agent still works, answers appear as text only. */
export const muted = writable(
  typeof localStorage !== "undefined" &&
    localStorage.getItem("voice-muted") === "1",
);
export const recording = writable(false);
export const youSaid = writable("");
export const holonsSaid = writable("");
export const activeTool = writable<string | null>(null);
export const bubbleOpen = writable(false);
export const typeOpen = writable(false);

let backend: VoiceBackend | null = null;
let player: PcmPlayer | null = null;
let stream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let procNode: ScriptProcessorNode | null = null;
let pcmChunks: Float32Array[] = [];
let bubbleTimer: ReturnType<typeof setTimeout> | null = null;
let inited = false;

function showBubble() {
  bubbleOpen.set(true);
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = null;
}

/**
 * Toggle spoken replies. Muting cuts any playback mid-word and tells the
 * backend to stop synthesizing TTS at all (text frames keep flowing).
 */
export function toggleMute() {
  muted.update((m) => {
    const next = !m;
    try {
      localStorage.setItem("voice-muted", next ? "1" : "0");
    } catch {
      /* private mode — mute just won't survive a reload */
    }
    if (next) {
      player?.stop();
      status.update((s) => (s === "speaking" ? "ready" : s));
    }
    backend?.setMuted(next);
    return next;
  });
}

function armBubbleFade() {
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    bubbleOpen.set(false);
    bubbleTimer = null;
  }, BUBBLE_LINGER_MS);
}

/**
 * Dismiss the popup: cut any playback, cancel the in-flight turn (barge-in,
 * same as starting to talk over it), and hide the bubble immediately.
 */
export function closeBubble() {
  player?.stop();
  backend?.bargeIn();
  status.set("ready");
  activeTool.set(null);
  bubbleOpen.set(false);
  if (bubbleTimer) {
    clearTimeout(bubbleTimer);
    bubbleTimer = null;
  }
}

function selectionSummary(sel: Selection): string | null {
  if (!sel) return null;
  if (sel.kind === "thing") {
    const it = sel.item;
    const from =
      typeof it._holon === "string" ? ` from holon ${it._holon}` : "";
    return `library item "${it.description || it.id}" (id ${it.id})${from}`;
  }
  const q = sel.quest as Record<string, unknown>;
  const from = typeof q._holon === "string" ? ` from holon ${q._holon}` : "";
  const kind = sel.kind === "event" ? "calendar event" : "task";
  return `${kind} "${String(q.title ?? "")}" (id ${String(q.id ?? "")})${from}`;
}

function uiContext(): VoiceContext {
  const ctx: VoiceContext = { app: "kiosk" };
  const holon = get(holonId);
  if (holon) ctx.holon = holon;
  const name = get(holonName);
  if (name) ctx.holonName = name;
  ctx.view = get(activeTab);
  // Advertise the tabs the agent may switch to — the backend validates
  // navigate calls against this list.
  ctx.views = get(visibleTabs)
    .map((t) => t.id)
    .join(",");
  // Browser-local IANA timezone, so "today at 2" schedules in the user's
  // local time even when the pipeline runs elsewhere.
  try {
    ctx.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* leave unset — the backend falls back to its own zone */
  }
  const editing = selectionSummary(get(selection));
  if (editing) ctx.editing = editing;
  return ctx;
}

// ── Backend events ─────────────────────────────────────────────────────────

function onBackendEvent(ev: BackendEvent) {
  switch (ev.type) {
    case "ready":
      player = new PcmPlayer(ev.sampleRate);
      available.set(true);
      status.set("ready");
      // Announce where we are so the backend can pre-warm this holon's data
      // before the first utterance (cold lens reads take seconds).
      backend?.context(uiContext());
      // Restore a persisted mute so the backend skips TTS from the first turn.
      if (get(muted)) backend?.setMuted(true);
      break;
    case "down":
      available.set(false);
      stopRecording(true);
      player?.stop();
      break;
    case "transcript":
      youSaid.set(ev.text);
      holonsSaid.set("");
      status.set("thinking");
      showBubble();
      break;
    case "tool":
      activeTool.set(ev.name);
      showBubble();
      break;
    case "assistant":
      activeTool.set(null);
      holonsSaid.set(ev.text);
      showBubble();
      break;
    case "tts_start":
      if (!get(muted)) status.set("speaking");
      break;
    case "tts_pcm":
      // In-flight audio may still arrive right after muting — drop it.
      if (!get(muted)) player?.enqueuePcm16(ev.pcm);
      break;
    case "tts_end":
      status.set("ready");
      armBubbleFade();
      break;
    case "navigate": {
      // Agent-driven tab switch (the navigate tool). selectTab also counts
      // as an interaction, pausing auto-rotation like a touch would.
      const tab = get(visibleTabs).find((t) => t.id === ev.view);
      if (tab) selectTab(tab.id);
      break;
    }
    case "error":
      activeTool.set(null);
      holonsSaid.set(`⚠ ${ev.message}`);
      status.set("ready");
      showBubble();
      armBubbleFade();
      break;
  }
}

// ── Push-to-talk capture (mic acquired lazily on first press) ─────────────

export async function startRecording(): Promise<void> {
  if (get(recording) || !get(available) || !backend) return;
  // Barge-in: cut any playback and tell the backend to cancel output.
  player?.stop();
  backend.bargeIn();

  if (!stream) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      holonsSaid.set("⚠ Microphone unavailable");
      showBubble();
      armBubbleFade();
      return;
    }
  }
  if (get(recording) || !backend) return; // released while permission prompt was up

  pcmChunks = [];
  audioCtx = new (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext
  )();
  sourceNode = audioCtx.createMediaStreamSource(stream);
  procNode = audioCtx.createScriptProcessor(4096, 1, 1);
  procNode.onaudioprocess = (e) => {
    pcmChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  sourceNode.connect(procNode);
  procNode.connect(audioCtx.destination);
  recording.set(true);
  status.set("recording");
  showBubble();
}

function concat(chunks: Float32Array[]): Float32Array {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Float32Array(n);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Stop capture; `discard` drops the audio (connection lost / teardown). */
export function stopRecording(discard = false): void {
  if (!get(recording)) return;
  recording.set(false);
  const ctx = audioCtx;
  procNode?.disconnect();
  sourceNode?.disconnect();
  procNode = null;
  sourceNode = null;
  audioCtx = null;
  if (!ctx) return;

  const pcm = concat(pcmChunks);
  pcmChunks = [];
  const rate = ctx.sampleRate;
  void ctx.close();
  if (discard || pcm.length === 0 || !backend) {
    status.set("ready");
    return;
  }

  // Send WAV at the native capture rate; the STT normalizes it.
  backend.utterance(encodeWav(pcm, rate), uiContext());
  // Immediate feedback: the bubble opens with animated dots right away —
  // STT + the first model pass can take a while and must not look frozen.
  youSaid.set("");
  holonsSaid.set("");
  status.set("thinking");
  showBubble();
}

/** Run pasted/typed text through the same agent pipeline (STT skipped). */
export function sendTyped(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || !backend || !get(available)) return false;
  player?.stop();
  backend.bargeIn();
  backend.text(trimmed, uiContext());
  typeOpen.set(false);
  youSaid.set(trimmed);
  holonsSaid.set("");
  status.set("thinking");
  showBubble();
  return true;
}

function makeBackend(): VoiceBackend {
  return resolveVoiceMode() === "direct"
    ? new DirectVoiceBackend()
    : new WsVoiceBackend(WS_URL_ENV ?? "ws://localhost:8787");
}

/**
 * Re-evaluate mode + availability after a Settings change (e.g. the caretaker
 * added or cleared the device's voice API key) — no reload needed.
 */
export function refreshVoice(): void {
  if (!inited || !backend) return;
  stopRecording(true);
  player?.stop();
  backend.stop();
  available.set(false);
  status.set("ready");
  backend = makeBackend();
  backend.start(onBackendEvent);
}

/** Start the backend; returns a teardown. Safe to call once from the layout. */
export function initVoice(): () => void {
  if (inited) return () => {};
  inited = true;
  backend = makeBackend();
  backend.start(onBackendEvent);
  return () => {
    inited = false;
    if (bubbleTimer) clearTimeout(bubbleTimer);
    stopRecording(true);
    player?.stop();
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    backend?.stop();
    backend = null;
    available.set(false);
  };
}
