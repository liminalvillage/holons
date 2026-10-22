// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Direct voice backend — no voice server. The browser itself runs the whole
// pipeline against the OpenAI API:
//
//   mic WAV ─→ Whisper (audio/transcriptions)
//            ─→ agent loop (@holons/ai-ui runAgentLoop over chat/completions)
//                 reads + UI tools: tools.ts, executed right here
//                 task writes: STAGED into the review drawer (plan.ts) —
//                 the user applies them by touch, nothing lands otherwise
//            ─→ tts-1 (audio/speech, streamed 24 kHz PCM)
//
// Auth is resolved per turn (transport.ts): a client-held key (Settings /
// dev env) calls api.openai.com directly; otherwise the calls go through
// this deploy's /api/ai/voice relay, which holds the same server-side
// OPENAI_API_KEY the AI-breakdown feature uses.
//
// Each utterance is one agent turn; a sliding window of past exchanges gives
// "it" / "that one" something to resolve against. A new utterance or an
// explicit barge-in aborts the in-flight turn's output.

import { get } from "svelte/store";
import {
  runAgentLoop,
  OpenAICompatProvider,
  STAGING_GUIDANCE,
  claimsCompletedAction,
  claimsDespiteStaging,
  correctionHistory,
  correctionPrompt,
  hasSuccessfulWrite,
  hasWriteAttempt,
  looksLikeActionRequest,
} from "@holons/ai-ui";
import type { HistoryMessage, ToolAudit, ToolCall } from "@holons/ai-ui";
import { isTaskAction } from "@holons/core/actions";
import { holonId, holonName, selection } from "$lib/stores";
import { currentUser } from "$lib/auth";
import { resolveVoiceKey } from "$lib/config";
import {
  affirmativeLang,
  holonLang,
  lang,
  langMode,
  tr,
  type Lang,
} from "$lib/i18n";
import {
  transcribe,
  synthesizeSpeech,
  TTS_PCM_SAMPLE_RATE,
  type OpenAIVoiceOptions,
} from "$lib/voice/openai";
import {
  VOICE_PROXY_BASE,
  pickVoiceTransport,
  type VoiceTransport,
} from "$lib/voice/transport";
import {
  KIOSK_VOICE_TOOLS,
  dispatchKioskTool,
  digestTasks,
  digestMembers,
} from "$lib/voice/tools";
import {
  discardPlan,
  lastStagedTaskId,
  pendingLines,
  projectedQuests,
  stageCall,
  changeCount,
} from "$lib/voice/plan";
import { loadMembers } from "$lib/members";
import type {
  BackendEvent,
  VoiceBackend,
  VoiceContext,
} from "$lib/voice/backend";

const env = import.meta.env as Record<string, string | undefined>;
const LLM_MODEL = env.VITE_VOICE_LLM_MODEL || "gpt-4o-mini";

/**
 * The transport is resolved per turn (a Settings-entered key on this device,
 * a dev env var, or the deploy's relay — see transport.ts), so a caretaker
 * adding or clearing the key in Settings takes effect without a rebuild.
 */
function openaiOpts(transport: VoiceTransport): OpenAIVoiceOptions {
  return {
    baseUrl: transport.baseUrl,
    apiKey: transport.apiKey,
    sttModel: env.VITE_VOICE_STT_MODEL || "whisper-1",
    ttsModel: env.VITE_VOICE_TTS_MODEL || "tts-1",
    ttsVoice: env.VITE_VOICE_TTS_VOICE || "alloy",
    // Whisper hint only when the language is affirmatively known (pin or
    // holon setting) — a device-locale fallback must not pin transcription.
    language: affirmativeLang(get(langMode), get(holonLang)) ?? undefined,
  };
}

/** Whether a client-held key is available right now (device or dev env). */
export function hasDirectVoiceKey(): boolean {
  return !!resolveVoiceKey();
}

// Whether the deploy's /api/ai/voice relay holds a key, probed once per page
// load — the same pattern as $lib/breakdown's probe of its own route. A
// static/self-hosted build without serverless functions 404s → false. The
// resolved value is mirrored into `serverConfigured` so per-turn transport
// resolution stays synchronous.
let serverProbe: Promise<boolean> | null = null;
let serverConfigured = false;
export function serverVoiceConfigured(): Promise<boolean> {
  if (!serverProbe) {
    serverProbe = fetch(VOICE_PROXY_BASE)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !!(d as { configured?: boolean } | null)?.configured)
      .catch(() => false)
      .then((ok) => (serverConfigured = ok));
  }
  return serverProbe;
}

/** This turn's transport, or null when neither a key nor the relay exists. */
function currentTransport(): VoiceTransport | null {
  return pickVoiceTransport(resolveVoiceKey(), serverConfigured);
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
  "turn. If a tool failed or you called none, say so plainly — never pretend. " +
  "Focus: when the user says 'it', 'this one', 'that task', they mean the task " +
  "named in the Focus line of the context; pass no taskId/taskRef then. " +
  "People: name them as said (user.name); the kiosk resolves who it is. " +
  "Times: pass only what the user said — a bare time keeps the task's day. " +
  STAGING_GUIDANCE;

/**
 * Per-turn language directive appended to the system prompt. The
 * meta-instruction itself stays English (models follow English instructions
 * most reliably); tool results and context lines are English by design — the
 * directive makes the model translate on the way out.
 */
const LANG_NAMES: Record<Lang, string> = {
  en: "English",
  it: "Italian",
  es: "Spanish",
};

function languageLine(): string {
  const name = LANG_NAMES[get(lang)];
  return (
    `Language: reply and speak in ${name}, regardless of the language of ` +
    "tool results or context lines (translate them). If the user clearly " +
    "speaks a different language, mirror the user instead."
  );
}

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
  const user = get(currentUser);
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

/**
 * Live tasks snapshot so the model starts every turn holding the real ids —
 * projected through the pending plan, so a task staged for creation is
 * already addressable ("and add Marco to it").
 */
function snapshotLine(): string {
  const quests = projectedQuests();
  if (quests.length === 0) return "";
  return `\nLive tasks snapshot (id, title, status): ${digestTasks(quests)}`;
}

/** What "it" refers to: the last staged target first, then the open card. */
function focusLine(): string {
  const quests = projectedQuests();
  const byId = (id: string | null) =>
    id ? quests.find((q) => String(q.id ?? "") === id) : undefined;
  const staged = byId(get(lastStagedTaskId));
  const sel = get(selection);
  const open =
    sel && sel.kind !== "thing" ? byId(String(sel.quest.id ?? "")) : undefined;
  const parts: string[] = [];
  if (staged)
    parts.push(
      `Focus (last proposed change): "${staged.title}" (id ${staged.id}) — 'it' most likely means this.`,
    );
  if (open && open !== staged)
    parts.push(`Open card: "${open.title}" (id ${open.id}).`);
  return parts.length ? `\n${parts.join(" ")}` : "";
}

/** The plan awaiting approval, so a follow-up refines it instead of duplicating. */
function pendingLine(): string {
  const lines = pendingLines();
  return lines
    ? `\nProposed changes awaiting the user's approval in the review panel (a new call on the same task replaces or extends these):\n${lines}`
    : "";
}

/** The roster, so a person can be named as said. */
async function membersLine(): Promise<string> {
  const hid = get(holonId);
  if (!hid) return "";
  const members = await loadMembers(hid);
  return members.length
    ? `\nMembers (id, name): ${digestMembers(members)}`
    : "";
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
    // A client-held key means availability with no probing.
    if (resolveVoiceKey()) {
      onEvent({ type: "ready", sampleRate: TTS_PCM_SAMPLE_RATE });
      return;
    }
    // Otherwise availability is the deploy's relay. `this.onEvent` is read at
    // fire time, so a stop() before the probe lands makes this a no-op.
    void serverVoiceConfigured().then((ok) => {
      if (ok) this.onEvent({ type: "ready", sampleRate: TTS_PCM_SAMPLE_RATE });
    });
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
    const transport = currentTransport();
    if (!transport) {
      this.onEvent({ type: "error", message: tr("voice.notConfigured") });
      return;
    }
    const signal = this.beginTurn();
    void (async () => {
      const text = await transcribe(wav, openaiOpts(transport), signal);
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
      message = resolveVoiceKey()
        ? tr("voice.keyUnreachable")
        : tr("voice.serviceUnreachable");
    }
    this.onEvent({ type: "error", message });
  }

  private async respond(
    text: string,
    context: VoiceContext,
    signal: AbortSignal,
  ): Promise<void> {
    const transport = currentTransport();
    if (!transport) {
      // Never claim (or silently drop) a turn the pipeline can't perform.
      this.onEvent({ type: "error", message: tr("voice.notConfigured") });
      return;
    }
    this.onEvent({ type: "transcript", text });

    const hid = get(holonId);
    if (hid && hid !== this.historyHolon) {
      // A holon switch voids "it"/"that one" AND the plan proposed there.
      if (this.historyHolon) {
        this.history = [];
        discardPlan();
        lastStagedTaskId.set(null);
      }
      this.historyHolon = hid;
    }

    const provider = new OpenAICompatProvider({
      baseUrl: transport.baseUrl,
      apiKey: transport.apiKey,
      model: LLM_MODEL,
    });

    // Every dispatched tool call is recorded as a fact (name + outcome) so
    // the reply's claims can be checked against what actually ran — the same
    // turn harness the voice server enforces (@holons/ai-ui). Task writes are
    // staged (recorded as such), never executed from a turn.
    const audit: ToolAudit[] = [];
    const dispatch = async (call: ToolCall) => {
      if (signal.aborted) {
        return {
          id: call.id,
          content: "Cancelled by the user.",
          isError: true,
        };
      }
      this.onEvent({ type: "tool", name: call.name });
      if (isTaskAction(call.name)) {
        const result = await stageCall(call, text);
        audit.push({
          name: call.name,
          ok: !result.isError,
          staged: !result.isError,
        });
        this.onEvent({ type: "plan", size: changeCount() });
        return result;
      }
      const result = await dispatchKioskTool(call, (view) =>
        this.onEvent({ type: "navigate", view }),
      );
      audit.push({ name: call.name, ok: !result.isError });
      if (call.name === "plan_discard")
        this.onEvent({ type: "plan", size: changeCount() });
      return result;
    };

    // Speak only the LAST text the model produced: chunks emitted between
    // tool calls are running commentary, often stale once the loop settles.
    const run = async (prompt: string, history: HistoryMessage[]) => {
      const texts: string[] = [];
      const result = await runAgentLoop({
        provider,
        tools: KIOSK_VOICE_TOOLS,
        dispatch,
        system: `${SYSTEM_PROMPT} ${languageLine()}`,
        prompt,
        history,
        // In order: "create X and add Marco to it" stages the creation
        // before the join resolves against it.
        sequential: true,
        onText: (t) => {
          if (t.trim()) texts.push(t.trim());
        },
      });
      return (
        (texts.length ? texts[texts.length - 1] : "") || result.text.trim()
      );
    };

    const preamble =
      `${clockLine()}\n${contextLines(context)}${await membersLine()}` +
      `${snapshotLine()}${focusLine()}${pendingLine()}`;
    let speech = await run(
      `${preamble}\n\nUser request: ${text}`,
      this.history,
    );

    // Claim check: a reply asserting a completed action with no successful
    // write behind it is a hallucination. Staging check: the same claim over
    // changes that are only staged is just as false — nothing landed yet.
    // Write check: an action-shaped request must END in at least one
    // attempted (or staged) write — a clarifying question is the one
    // legitimate way out. Either way, one corrective pass.
    const staged = claimsDespiteStaging(speech, audit);
    const claimed =
      !staged && claimsCompletedAction(speech) && !hasSuccessfulWrite(audit);
    const dodged =
      looksLikeActionRequest(text) &&
      !hasWriteAttempt(audit) &&
      !speech.trimEnd().endsWith("?");
    if ((staged || claimed || dodged) && !signal.aborted) {
      const reason = staged ? "staged" : claimed ? "claimed" : "no_write";
      speech = await run(
        `${preamble}\n\n${correctionPrompt(audit, reason)}`,
        correctionHistory(this.history, text, speech),
      );
    }

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
    for await (const pcm of synthesizeSpeech(
      speech,
      openaiOpts(transport),
      signal,
    )) {
      if (signal.aborted) return;
      this.onEvent({ type: "tts_pcm", pcm });
    }
    this.onEvent({ type: "tts_end" });
  }
}
