// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Voice session controller — one WebSocket to @holons/voice-ui shared by the
// inline VoiceButtons (rendered in each view's fab row) and the VoiceWidget
// overlay (bubble + type panel). Probes the server and exposes `available`;
// when no voice server is reachable the buttons render nothing.

import { get, writable } from "svelte/store";
import { holonId, holonName, activeTab, selection, type Selection } from "$lib/stores";
import { encodeWav, bytesToBase64, base64ToBytes, PcmPlayer } from "$lib/voice/audio";

const WS_URL =
  (import.meta.env.VITE_VOICE_WS_URL as string | undefined) ??
  "ws://localhost:8787";
/** How often to re-probe for a voice server while none is reachable. */
const RETRY_MS = 30_000;
/** How long the reply bubble lingers after the agent finishes speaking. */
const BUBBLE_LINGER_MS = 8_000;

export const available = writable(false);
export const status = writable<"ready" | "recording" | "thinking" | "speaking">(
  "ready",
);
export const recording = writable(false);
export const youSaid = writable("");
export const holonsSaid = writable("");
export const activeTool = writable<string | null>(null);
export const bubbleOpen = writable(false);
export const typeOpen = writable(false);

let ws: WebSocket | null = null;
let player: PcmPlayer | null = null;
let stream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let procNode: ScriptProcessorNode | null = null;
let pcmChunks: Float32Array[] = [];
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let bubbleTimer: ReturnType<typeof setTimeout> | null = null;
let destroyed = false;
let inited = false;

function showBubble() {
  bubbleOpen.set(true);
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = null;
}

function armBubbleFade() {
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    bubbleOpen.set(false);
    bubbleTimer = null;
  }, BUBBLE_LINGER_MS);
}

function selectionSummary(sel: Selection): string | null {
  if (!sel) return null;
  if (sel.kind === "thing") {
    const it = sel.item;
    const from = typeof it._holon === "string" ? ` from holon ${it._holon}` : "";
    return `library item "${it.description || it.id}" (id ${it.id})${from}`;
  }
  const q = sel.quest as Record<string, unknown>;
  const from = typeof q._holon === "string" ? ` from holon ${q._holon}` : "";
  const kind = sel.kind === "event" ? "calendar event" : "task";
  return `${kind} "${String(q.title ?? "")}" (id ${String(q.id ?? "")})${from}`;
}

function uiContext(): Record<string, string> {
  const ctx: Record<string, string> = { app: "kiosk" };
  const holon = get(holonId);
  if (holon) ctx.holon = holon;
  const name = get(holonName);
  if (name) ctx.holonName = name;
  ctx.view = get(activeTab);
  // Browser-local IANA timezone, so "today at 2" schedules in the user's
  // local time even when the voice server runs elsewhere.
  try {
    ctx.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* leave unset — server falls back to its own zone */
  }
  const editing = selectionSummary(get(selection));
  if (editing) ctx.editing = editing;
  return ctx;
}

// ── Server probe / connection ─────────────────────────────────────────────

function connect() {
  if (destroyed || ws) return;
  let sock: WebSocket;
  try {
    sock = new WebSocket(WS_URL);
  } catch {
    scheduleRetry();
    return;
  }
  sock.onmessage = onServerMessage;
  sock.onopen = () => {
    ws = sock;
  };
  sock.onerror = () => {
    /* onclose follows; retry is scheduled there */
  };
  sock.onclose = () => {
    if (ws === sock) ws = null;
    available.set(false);
    stopRecording(true);
    player?.stop();
    scheduleRetry();
  };
}

function scheduleRetry() {
  if (destroyed || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, RETRY_MS);
}

function onServerMessage(ev: MessageEvent) {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(ev.data as string);
  } catch {
    return;
  }
  switch (msg.type) {
    case "ready":
      player = new PcmPlayer(Number(msg.sampleRate) || 24000);
      available.set(true);
      status.set("ready");
      // Announce where we are so the server pre-warms this holon's data
      // before the first utterance (cold lens reads take seconds).
      ws?.send(JSON.stringify({ type: "context", context: uiContext() }));
      break;
    case "transcript":
      youSaid.set(String(msg.text));
      holonsSaid.set("");
      status.set("thinking");
      showBubble();
      break;
    case "tool":
      activeTool.set(String(msg.name));
      showBubble();
      break;
    case "assistant":
      activeTool.set(null);
      holonsSaid.set(String(msg.text));
      showBubble();
      break;
    case "tts_start":
      status.set("speaking");
      break;
    case "tts":
      player?.enqueuePcm16(base64ToBytes(String(msg.audio)));
      break;
    case "tts_end":
      status.set("ready");
      armBubbleFade();
      break;
    case "error":
      activeTool.set(null);
      holonsSaid.set(`⚠ ${String(msg.message)}`);
      status.set("ready");
      showBubble();
      armBubbleFade();
      break;
  }
}

// ── Push-to-talk capture (mic acquired lazily on first press) ─────────────

export async function startRecording(): Promise<void> {
  if (get(recording) || !get(available) || !ws) return;
  // Barge-in: cut any playback and tell the server to cancel output.
  player?.stop();
  ws.send(JSON.stringify({ type: "barge_in" }));

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
  if (get(recording) || !ws) return; // released while permission prompt was up

  pcmChunks = [];
  audioCtx = new (window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext)();
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
  if (discard || pcm.length === 0 || !ws) {
    status.set("ready");
    return;
  }

  // Send WAV at the native capture rate; the server's STT normalizes it.
  const wav = encodeWav(pcm, rate);
  ws.send(
    JSON.stringify({
      type: "utterance",
      mime: "audio/wav",
      audio: bytesToBase64(wav),
      context: uiContext(),
    }),
  );
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
  if (!trimmed || !ws || !get(available)) return false;
  player?.stop();
  ws.send(JSON.stringify({ type: "barge_in" }));
  ws.send(JSON.stringify({ type: "text", text: trimmed, context: uiContext() }));
  typeOpen.set(false);
  youSaid.set(trimmed);
  holonsSaid.set("");
  status.set("thinking");
  showBubble();
  return true;
}

/** Start probing; returns a teardown. Safe to call once from the layout. */
export function initVoice(): () => void {
  if (inited) return () => {};
  inited = true;
  destroyed = false;
  connect();
  return () => {
    destroyed = true;
    inited = false;
    if (retryTimer) clearTimeout(retryTimer);
    if (bubbleTimer) clearTimeout(bubbleTimer);
    stopRecording(true);
    player?.stop();
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    ws?.close();
    ws = null;
  };
}
