// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Direct voice backend — no voice server. The browser itself runs the whole
// pipeline against the OpenAI API with the key inlined at build time:
//
//   mic WAV ─→ Whisper (audio/transcriptions)
//            ─→ agent loop (@holons/ai-ui runAgentLoop over chat/completions)
//                 tools: tools.ts, executed right here over Holosphere
//            ─→ tts-1 (audio/speech, streamed 24 kHz PCM)
//
// Each utterance is one agent turn; a sliding window of past exchanges gives
// "it" / "that one" something to resolve against. A new utterance or an
// explicit barge-in aborts the in-flight turn's output.

import { get } from "svelte/store";
import { runAgentLoop, OpenAICompatProvider } from "@holons/ai-ui";
import type { HistoryMessage } from "@holons/ai-ui";
import { holonId, holonName, rawQuests } from "$lib/stores";
import { telegramUser } from "$lib/auth";
import { resolveVoiceKey } from "$lib/config";
import {
  transcribe,
  synthesizeSpeech,
  TTS_PCM_SAMPLE_RATE,
  type OpenAIVoiceOptions,
} from "$lib/voice/openai";
import {
  KIOSK_VOICE_TOOLS,
  dispatchKioskTool,
  digestTasks,
} from "$lib/voice/tools";
import type {
  BackendEvent,
  VoiceBackend,
  VoiceContext,
} from "$lib/voice/backend";

const env = import.meta.env as Record<string, string | undefined>;
const LLM_MODEL = env.VITE_VOICE_LLM_MODEL || "gpt-4o-mini";

/**
 * The key is resolved per turn (Settings-entered on this device, falling back
 * to a dev env var — see resolveVoiceKey), so a caretaker adding or clearing
 * it in Settings takes effect without a rebuild.
 */
function openaiOpts(apiKey: string): OpenAIVoiceOptions {
  return {
    apiKey,
    sttModel: env.VITE_VOICE_STT_MODEL || "whisper-1",
    ttsModel: env.VITE_VOICE_TTS_MODEL || "tts-1",
    ttsVoice: env.VITE_VOICE_TTS_VOICE || "alloy",
  };
}

/** Whether the direct backend can run at all (a key is available right now). */
export function hasDirectVoiceKey(): boolean {
  return !!resolveVoiceKey();
}

/** Exchanges kept as short-term memory (each = one user + one assistant msg). */
const HISTORY_EXCHANGES = 6;

const SYSTEM_PROMPT =
  "You are the Holons voice agent on a shared community kiosk. You operate " +
  "the kiosk through tools. Prefer acting via tools over describing. Keep " +
  "spoken replies short and natural — one or two sentences — since they are " +
  "read aloud. Confirm before destructive or irreversible actions. " +
  "Record ids are opaque codes like 'mr3zld0hzsc' — always copy them EXACTLY " +
  "from the tasks snapshot or a list_items result; a number or a title is " +
  "never a valid id, and you must never invent one. When the user refers to " +
  "a record by name, pick the item whose title best matches what was said " +
  "(spoken words may be transcribed imperfectly — match loosely); if several " +
  "match, ask which one; if none match, say so. " +
  "Work out what the user actually wants and execute the FULL combination of " +
  "tool calls that fulfills it — find, then act, then any follow-up the " +
  "request implies. Do not stop after the first call and do not announce " +
  "what you are about to do instead of doing it. " +
  "Speak like a human, never like a database: refer to records by their " +
  "title, never read out ids, JSON, or field names. " +
  "Navigation: when the user asks to see or go to another part of the app, " +
  "call navigate with a view id from the views list. It only changes what is " +
  "on screen, never data. " +
  "Honesty: only claim an action happened if a tool call SUCCEEDED this " +
  "turn. If a tool failed or you called none, say so plainly — never pretend.";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Browser-local wall clock, so "tomorrow at 2" resolves in the user's zone. */
function clockLine(): string {
  const d = new Date();
  const iso =
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  let zone = "local time";
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? zone;
  } catch {
    /* keep fallback */
  }
  return (
    `Current local date/time (${zone}): ${iso}. Resolve every relative ` +
    "date — today, tomorrow, 'at 2', next week — against this, and pass " +
    "schedules to tools as separate date (YYYY-MM-DD) and time (HH:MM) fields."
  );
}

function contextLines(context: VoiceContext): string {
  const parts: string[] = [];
  const name = get(holonName);
  const hid = get(holonId);
  if (hid)
    parts.push(`Holon on screen: ${name ? `"${name}" ` : ""}(id ${hid}).`);
  if (context.view) parts.push(`Current view: ${context.view}.`);
  if (context.views) parts.push(`Available views: ${context.views}.`);
  if (context.editing)
    parts.push(`The user has this open: ${context.editing}.`);
  const user = get(telegramUser);
  if (user) {
    const who = [user.first_name, user.last_name].filter(Boolean).join(" ");
    parts.push(
      `Logged-in user: ${who || user.username || user.id} (user id ${user.id}).`,
    );
  } else {
    parts.push(
      "No one is logged in — reads work, but any write tool will ask for a Telegram login.",
    );
  }
  return parts.join(" ");
}

/** Live tasks snapshot so the model starts every turn holding the real ids. */
function snapshotLine(): string {
  const quests = get(rawQuests);
  if (quests.length === 0) return "";
  return `\nLive tasks snapshot (id, title, status): ${digestTasks(quests)}`;
}

export class DirectVoiceBackend implements VoiceBackend {
  private onEvent: (ev: BackendEvent) => void = () => {};
  private turn: AbortController | null = null;
  private muted = false;
  private history: HistoryMessage[] = [];
  /** The holon the history belongs to — a switch voids "it"/"that one". */
  private historyHolon: string | null = null;

  start(onEvent: (ev: BackendEvent) => void): void {
    this.onEvent = onEvent;
    // No probing needed — availability is having a key on this device.
    if (resolveVoiceKey())
      onEvent({ type: "ready", sampleRate: TTS_PCM_SAMPLE_RATE });
  }

  stop(): void {
    this.abort();
    this.onEvent = () => {};
  }

  bargeIn(): void {
    this.abort();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  context(_context: VoiceContext): void {
    // Nothing to pre-warm: reads come from the layout's live subscriptions.
  }

  utterance(wav: Uint8Array, context: VoiceContext): void {
    const key = resolveVoiceKey();
    if (!key) return;
    const signal = this.beginTurn();
    void (async () => {
      const text = await transcribe(wav, openaiOpts(key), signal);
      if (signal.aborted) return;
      if (!text) return; // no speech recognized — stay quiet like the server
      await this.respond(text, context, signal);
    })().catch((err) => this.reportError(err, signal));
  }

  text(text: string, context: VoiceContext): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const signal = this.beginTurn();
    void this.respond(trimmed, context, signal).catch((err) =>
      this.reportError(err, signal),
    );
  }

  private beginTurn(): AbortSignal {
    this.abort();
    const ac = new AbortController();
    this.turn = ac;
    return ac.signal;
  }

  private abort(): void {
    this.turn?.abort();
    this.turn = null;
  }

  private reportError(err: unknown, signal: AbortSignal): void {
    if (signal.aborted) return;
    let message = err instanceof Error ? err.message : String(err);
    // A rejected browser fetch is how a bad key usually surfaces (OpenAI's
    // 401 carries no CORS headers, so the browser hides the status). Say
    // something a caretaker can act on instead of "Failed to fetch".
    if (/failed to fetch|load failed/i.test(message)) {
      message =
        "Could not reach OpenAI — check the API key in Settings and the network connection.";
    }
    this.onEvent({ type: "error", message });
  }

  private async respond(
    text: string,
    context: VoiceContext,
    signal: AbortSignal,
  ): Promise<void> {
    const key = resolveVoiceKey();
    if (!key) return;
    this.onEvent({ type: "transcript", text });

    const hid = get(holonId);
    if (hid && hid !== this.historyHolon) {
      if (this.historyHolon) this.history = [];
      this.historyHolon = hid;
    }

    const provider = new OpenAICompatProvider({
      baseUrl: "https://api.openai.com/v1",
      apiKey: key,
      model: LLM_MODEL,
    });

    // Speak only the LAST text the model produced: chunks emitted between
    // tool calls are running commentary, often stale once the loop settles.
    const texts: string[] = [];
    const result = await runAgentLoop({
      provider,
      tools: KIOSK_VOICE_TOOLS,
      dispatch: async (call) => {
        if (signal.aborted) {
          return {
            id: call.id,
            content: "Cancelled by the user.",
            isError: true,
          };
        }
        this.onEvent({ type: "tool", name: call.name });
        return dispatchKioskTool(call, (view) =>
          this.onEvent({ type: "navigate", view }),
        );
      },
      system: SYSTEM_PROMPT,
      prompt:
        `${clockLine()}\n${contextLines(context)}${snapshotLine()}` +
        `\n\nUser request: ${text}`,
      history: this.history,
      onText: (t) => {
        if (t.trim()) texts.push(t.trim());
      },
    });
    const speech =
      (texts.length ? texts[texts.length - 1] : "") || result.text.trim();

    // Record the exchange even if the user barged in — the tools already ran,
    // so the next turn's "it"/"that one" must still resolve against it.
    this.history = [
      ...this.history.slice(-(HISTORY_EXCHANGES - 1) * 2),
      { role: "user", content: text },
      { role: "assistant", content: speech },
    ];
    if (signal.aborted) return;
    this.onEvent({ type: "assistant", text: speech });
    if (!speech || this.muted) return;

    this.onEvent({ type: "tts_start" });
    for await (const pcm of synthesizeSpeech(speech, openaiOpts(key), signal)) {
      if (signal.aborted) return;
      this.onEvent({ type: "tts_pcm", pcm });
    }
    this.onEvent({ type: "tts_end" });
  }
}
