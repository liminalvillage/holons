// WebSocket voice server.
//
// Protocol (all frames are JSON text; audio travels base64-encoded for
// unambiguous framing over one channel):
//   client → server:
//     { type: 'utterance', mime, audio: <base64> }   one complete utterance
//     { type: 'barge_in' }                            user started talking; cancel output
//     { type: 'mute', muted }                         true: skip TTS entirely (text-only)
//   server → client:
//     { type: 'ready', sampleRate }
//     { type: 'transcript', text }
//     { type: 'assistant', text }
//     { type: 'tool', name }
//     { type: 'tts_start', sampleRate } / { type: 'tts', audio } / { type: 'tts_end' }
//     { type: 'navigate', view }    switch the client UI to another view/tab
//     { type: 'error', message }
//
// One utterance is processed at a time per connection; a new utterance or an
// explicit barge_in aborts the in-flight turn's TTS (and suppresses its output).

import { WebSocketServer, type WebSocket } from 'ws';
import {
  runAgentLoop,
  type AgentTool,
  type HistoryMessage,
  type ToolDispatcher,
} from '@holons/ai-ui';
import type { VoiceConfig } from './config.js';
import { formatUiContext } from './context.js';
import {
  buildSnapshot,
  claimsCompletedAction,
  correctionHistory,
  correctionPrompt,
  digestQuests,
  digestUsers,
  fuzzyFindByTitle,
  hasSuccessfulWrite,
  hasWriteAttempt,
  idSpecFor,
  localIso,
  looksLikeActionRequest,
  titleMismatch,
  type ToolAudit,
} from './harness.js';
import { slideWindow } from './history.js';
import {
  UI_NAVIGATE,
  navigateOutcome,
  uiNavigateTool,
  viewsFromContext,
} from './ui-tools.js';
import { connectHolonsMcp, type HolonsMcp } from './mcp-client.js';
import { makeLLM, makeSTT, makeTTS } from './factory.js';
import type { STTProvider } from './providers/stt/types.js';
import type { TTSProvider } from './providers/tts/types.js';

interface ClientMessage {
  type: 'utterance' | 'barge_in' | 'text' | 'context' | 'mute';
  mime?: string;
  audio?: string;
  text?: string;
  /** For type 'mute': whether spoken replies are off. */
  muted?: boolean;
  /** What the client UI is showing (holon, view, open record) — see context.ts. */
  context?: unknown;
}

/** Which lens a tool family's records live in, for the not-found recovery. */
const LENS_BY_TOOL_PREFIX: Array<[prefix: string, lens: string]> = [
  ['task', 'quests'],
  ['subtask', 'checklists'],
  ['checklist', 'checklists'],
  ['library', 'library'],
  ['shopping', 'shopping'],
  ['role', 'roles'],
];

/** Compact {id, title} digest of a lens listing, small enough to inline. */
function digestLensItems(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { items?: unknown };
    if (!Array.isArray(parsed.items)) return null;
    const rows = parsed.items.slice(0, 40).map((it) => {
      const r = it as Record<string, unknown>;
      const title = r.title ?? r.description ?? r.name ?? '';
      return { id: r.id, title, status: r.status };
    });
    return JSON.stringify(rows);
  } catch {
    return null;
  }
}

/**
 * Wrap the MCP dispatcher with deterministic not-found recovery: when a
 * lookup fails because the model guessed a record id from the spoken title (a
 * habit small local models fall into despite the system-prompt rule), fetch
 * the relevant lens ourselves and inline the real {id, title} list into the
 * tool result — the model only has to pick the matching id and retry, rather
 * than decide to go searching (which weak models routinely fail to do).
 */
function withNotFoundHint(dispatch: ToolDispatcher): ToolDispatcher {
  // Per-turn guard: small local models sometimes retry the exact same failing
  // call. After two identical failures, stop re-explaining and force a change
  // of approach (the wrapper is created fresh for every turn, so this state
  // never leaks across turns).
  const failures = new Map<string, number>();
  return async (call) => {
    const signature = `${call.name}:${JSON.stringify(call.input)}`;
    if ((failures.get(signature) ?? 0) >= 2) {
      return {
        id: call.id,
        isError: true,
        content:
          'You already tried this exact call twice and it failed. Do not ' +
          'repeat it. Change approach: re-read the tool description, use the ' +
          'listed real ids, or tell the user what is blocking you.',
      };
    }

    const result = await dispatch(call);
    if (result.isError) failures.set(signature, (failures.get(signature) ?? 0) + 1);
    if (!result.isError || !/not found/i.test(result.content)) return result;

    const holon = call.input.holon;
    const lens = LENS_BY_TOOL_PREFIX.find(([p]) => call.name.startsWith(p))?.[1];
    if (typeof holon !== 'string' || !lens) return result;

    const listing = await dispatch({
      id: `${call.id}-notfound-recovery`,
      name: 'lens_get_all',
      input: { holon, lens },
    });
    const digest = listing.isError ? null : digestLensItems(listing.content);
    if (!digest) return result;

    return {
      ...result,
      content:
        result.content +
        `\nThe id was probably guessed. These are the ACTUAL items in lens ` +
        `"${lens}" of holon ${holon}: ${digest}\n` +
        'Pick the item whose title matches the request and call this tool ' +
        'again now with that exact id. Do not answer the user before retrying.',
    };
  };
}

class Session {
  private turn: AbortController | null = null;
  /** Client asked for text-only replies — skip TTS synthesis entirely. */
  private muted = false;
  /** Sliding window of past exchanges, replayed each turn (see history.ts). */
  private history: HistoryMessage[] = [];
  /** The context holon the history belongs to (see the reset in respond). */
  private historyHolon: string | null = null;
  /**
   * Session-level lens cache, stale-while-revalidate. Holosphere's getAll
   * blocks up to 8s on a cold or EMPTY lens (READ_TIMEOUT_MS) and resolves
   * every hologram over the relay, so a turn must never wait on a refetch:
   * stale items are served immediately and refreshed in the background.
   * Flushed after our own successful writes.
   */
  private lens = new Map<string, { at: number; items: Array<Record<string, unknown>> }>();

  constructor(
    private readonly ws: WebSocket,
    private readonly config: VoiceConfig,
    private readonly stt: STTProvider,
    private readonly tts: TTSProvider,
    private readonly mcp: HolonsMcp,
  ) {
    ws.on('message', (data) => this.onMessage(data as Buffer));
    ws.on('close', () => this.abort());
    this.send({ type: 'ready', sampleRate: this.tts.sampleRate });
  }

  private send(obj: Record<string, unknown>): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(obj));
  }

  private abort(): void {
    this.turn?.abort();
    this.turn = null;
  }

  private onMessage(data: Buffer): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString('utf8')) as ClientMessage;
    } catch {
      this.send({ type: 'error', message: 'invalid message (expected JSON)' });
      return;
    }
    if (msg.type === 'barge_in') {
      this.abort();
      return;
    }
    if (msg.type === 'mute') {
      this.muted = msg.muted === true;
      return;
    }
    if (msg.type === 'context') {
      // Pre-warm the holon's lenses as soon as the client announces where it
      // is, so the first spoken turn doesn't pay the cold getAll (8s/lens).
      void this.prewarm(msg.context);
      return;
    }
    if (msg.type === 'utterance' && msg.audio) {
      // New utterance implicitly barges in on any in-flight turn.
      const signal = this.beginTurn();
      this.handleUtterance(
        Buffer.from(msg.audio, 'base64'),
        msg.mime ?? 'audio/wav',
        signal,
        msg.context,
      ).catch((err) => this.reportError(err, signal));
    }
    if (msg.type === 'text' && typeof msg.text === 'string') {
      // Typed transcript — skip STT, run the agent directly. Handy for testing
      // (e.g. when STT mishears domain words) and for keyboard-only use.
      const text = msg.text.trim();
      if (!text) return;
      const signal = this.beginTurn();
      this.respond(text, signal, msg.context).catch((err) =>
        this.reportError(err, signal),
      );
    }
  }

  private beginTurn(): AbortSignal {
    this.abort();
    const ac = new AbortController();
    this.turn = ac;
    return ac.signal;
  }

  private reportError(err: unknown, signal: AbortSignal): void {
    if (signal.aborted) return;
    this.send({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  private async handleUtterance(
    audio: Buffer,
    mime: string,
    signal: AbortSignal,
    context?: unknown,
  ): Promise<void> {
    const transcript = await this.stt.transcribe(audio, mime);
    if (signal.aborted) return;
    if (!transcript) {
      console.error('[turn] (no speech recognized)');
      return;
    }
    await this.respond(transcript, signal, context);
  }

  /**
   * Verify record ids before dispatch and repair invented ones. If a call's
   * taskId/checklistId/id is not present in its lens, fuzzy-match the given
   * value plus the user's utterance against the real items' titles: a clear
   * winner rewrites the call in place; close calls bounce back to the model
   * with the shortlist. Lens reads are cached for the turn.
   */
  private resolvingIds(dispatch: ToolDispatcher, utterance: string): ToolDispatcher {
    return async (call) => {
      const spec = idSpecFor(call.name, call.input);
      const holon = call.input.holon;
      if (spec && typeof holon === 'string') {
        const given = call.input[spec.field] as string;
        let chosen: Record<string, unknown> | undefined;
        for (const lens of spec.lenses) {
          chosen = (await this.fetchLens(holon, lens, 10_000)).find(
            (it) => String(it?.id) === given,
          );
          if (chosen) break;
        }
        if (chosen) {
          // The id is real — but is it the record the user actually named?
          // Observed failure: a valid id belonging to a completely different
          // task than the one spoken. The utterance is authoritative.
          const better = titleMismatch(
            utterance,
            { id: given, title: String(chosen.title ?? '') },
            await this.fetchLens(holon, spec.lenses[0], 10_000),
          );
          if (better) {
            console.error(
              `[harness] ${call.name}: ${spec.field} "${given}" ("${chosen.title}") ` +
                `contradicts the utterance → ${better.id} ("${better.title}")`,
            );
            call = { ...call, input: { ...call.input, [spec.field]: better.id } };
          }
        } else {
          const found = fuzzyFindByTitle(
            `${given} ${utterance}`,
            await this.fetchLens(holon, spec.lenses[0], 10_000),
          );
          if (found && 'id' in found) {
            console.error(
              `[harness] ${call.name}: resolved ${spec.field} "${given}" → ${found.id} ("${found.title}")`,
            );
            call = { ...call, input: { ...call.input, [spec.field]: found.id } };
          } else if (found) {
            return {
              id: call.id,
              isError: true,
              content:
                `${spec.field} "${given}" does not exist. Closest real items: ` +
                `${JSON.stringify(found.candidates)}. Retry with the exact id ` +
                'of the one the user meant, or ask the user which one.',
            };
          }
          // No plausible match → dispatch as-is; the not-found hint handles it.
        }
      }
      return dispatch(call);
    };
  }

  /**
   * Intercept client-side UI tools (ui_navigate): they never reach MCP — the
   * effect is a frame pushed to the client, which owns the actual view switch.
   * Target views are validated against the list the client advertised in this
   * turn's context, so the model can't send the UI somewhere it can't go.
   */
  private uiTools(
    dispatch: ToolDispatcher,
    utterance: string,
    context?: unknown,
  ): ToolDispatcher {
    return async (call) => {
      if (call.name !== UI_NAVIGATE) return dispatch(call);
      const outcome = navigateOutcome(call.input, viewsFromContext(context), utterance);
      if (outcome.ok) this.send({ type: 'navigate', view: outcome.view });
      return { id: call.id, content: outcome.message, isError: !outcome.ok };
    };
  }

  /** Record each dispatched call's outcome so the claim check can audit it. */
  private auditing(dispatch: ToolDispatcher, audit: ToolAudit[]): ToolDispatcher {
    return async (call) => {
      const result = await dispatch(call);
      audit.push({ name: call.name, ok: !result.isError });
      return result;
    };
  }

  /**
   * Cached lens read. Fresh entries are returned as-is; stale ones are
   * returned immediately while a background refresh replaces them; only a
   * cache miss awaits the (potentially 8s) network read.
   */
  private async fetchLens(
    holon: string,
    lens: string,
    ttlMs: number,
  ): Promise<Array<Record<string, unknown>>> {
    const key = `${holon}|${lens}`;
    const load = async () => {
      const tool =
        lens === 'users'
          ? { name: 'users_list', input: { holon }, listKey: 'users' }
          : { name: 'lens_get_all', input: { holon, lens }, listKey: 'items' };
      const res = await this.mcp.dispatch({ id: `cache-${key}`, name: tool.name, input: tool.input });
      let items: Array<Record<string, unknown>> = [];
      if (!res.isError) {
        try {
          const parsed = JSON.parse(res.content) as Record<string, unknown>;
          const list = parsed[tool.listKey];
          if (Array.isArray(list)) items = list;
        } catch {
          /* unparseable listing — keep [] */
        }
      }
      this.lens.set(key, { at: Date.now(), items });
      return items;
    };

    const entry = this.lens.get(key);
    if (!entry) return load();
    if (Date.now() - entry.at > ttlMs) void load().catch(() => {});
    return entry.items;
  }

  private static contextHolon(context: unknown): string | null {
    const holon =
      context && typeof context === 'object' && !Array.isArray(context)
        ? (context as Record<string, unknown>).holon
        : null;
    return typeof holon === 'string' && holon ? holon : null;
  }

  /** Kick off lens loads for the context holon without awaiting them. */
  private async prewarm(context: unknown): Promise<void> {
    const holon = Session.contextHolon(context);
    if (!holon) return;
    await Promise.allSettled([
      this.fetchLens(holon, 'quests', 10_000),
      this.fetchLens(holon, 'users', 300_000),
    ]);
    console.error(`[harness] prewarmed lenses for holon ${holon}`);
  }

  /**
   * Render the context holon's live state (tasks + members) as a prompt
   * suffix, so the model starts every turn holding the real ids instead of
   * needing to decide to look them up. Members change rarely → long TTL.
   */
  private async holonSnapshot(context: unknown): Promise<string> {
    const holon = Session.contextHolon(context);
    if (!holon) return '';
    const [quests, users] = await Promise.all([
      this.fetchLens(holon, 'quests', 10_000),
      this.fetchLens(holon, 'users', 300_000),
    ]);
    return buildSnapshot(
      holon,
      digestQuests(JSON.stringify({ items: quests })),
      digestUsers(JSON.stringify({ users })),
    );
  }

  /** Run one agent turn on a piece of text (from STT or typed), then speak it. */
  private async respond(
    text: string,
    signal: AbortSignal,
    context?: unknown,
  ): Promise<void> {
    console.error(`[turn] heard: "${text}"`);
    this.send({ type: 'transcript', text });

    // A holon switch voids the conversation: "it"/"that one" can no longer
    // resolve, and record ids quoted in old exchanges belong to the PREVIOUS
    // holon — a weak model happily reuses them on the new one. Fresh holon,
    // fresh history.
    const turnHolon = Session.contextHolon(context);
    if (turnHolon && turnHolon !== this.historyHolon) {
      if (this.historyHolon && this.history.length > 0) {
        console.error(
          `[harness] context holon ${this.historyHolon} → ${turnHolon}: history reset`,
        );
        this.history = [];
      }
      this.historyHolon = turnHolon;
    }

    const provider = makeLLM(this.config);
    const audit: ToolAudit[] = [];
    const dispatch = this.auditing(
      this.resolvingIds(
        withNotFoundHint(this.uiTools(this.mcp.dispatch, text, context)),
        text,
      ),
      audit,
    );
    // The model's internal sense of "today" is its training cutoff — years
    // stale. Without this line, "today at 2" gets scheduled in the past.
    // The browser reports its IANA timezone in the context, so a kiosk in a
    // different zone than this server still schedules in the USER's local time.
    const now = new Date();
    const tz =
      context && typeof context === 'object' && !Array.isArray(context)
        ? (context as Record<string, unknown>).timezone
        : undefined;
    const local = localIso(now, typeof tz === 'string' ? tz : undefined);
    const clock =
      `Current date/time in the user's timezone ${local.zone}: ${local.iso} ` +
      `(UTC reference: ${now.toISOString()}). Resolve every relative date — ` +
      'today, tomorrow, "at 2", next week — against the USER-LOCAL time, and ' +
      'write when/until as naive local ISO 8601 timestamps in that timezone ' +
      '(no Z suffix, no offset).';
    // Everything volatile (clock, UI context, holon snapshot) rides in the
    // per-turn USER message, never the system prompt: mlx_lm's KV cache
    // reuses the longest common prefix with the previous request, so keeping
    // [system + tools + history] byte-stable makes turn 2+ skip re-processing
    // the ~100 tool schemas that dominate first-token latency.
    const preamble =
      clock + formatUiContext(context) + (await this.holonSnapshot(context));
    const system = this.config.systemPrompt;

    // Speak only the LAST text the model produced: chunks emitted between
    // tool calls are running commentary ("Let me create one…"), often stale
    // by the time the loop settles on an outcome.
    const run = async (prompt: string, history: HistoryMessage[]) => {
      const texts: string[] = [];
      const result = await runAgentLoop({
        provider,
        tools: this.mcp.tools,
        dispatch,
        system,
        prompt,
        history,
        onText: (t) => {
          if (t.trim()) texts.push(t.trim());
        },
        onToolCall: (c) => {
          console.error(`[turn] tool: ${c.name} ${JSON.stringify(c.input)}`);
          this.send({ type: 'tool', name: c.name });
        },
      });
      return texts[texts.length - 1] ?? result.text.trim();
    };

    let speech = await run(
      `${preamble}\n\nUser request: ${text}`,
      this.history,
    );

    // Claim check: a reply asserting a completed action with no successful
    // write behind it is a hallucination. Write check: an action-shaped
    // request must END in at least one attempted write (a clarifying
    // question is the one legitimate way out). Either way, run one
    // corrective pass that actually does the work or owns up.
    const claimed = claimsCompletedAction(speech) && !hasSuccessfulWrite(audit);
    const dodged =
      looksLikeActionRequest(text) &&
      !hasWriteAttempt(audit) &&
      !speech.trimEnd().endsWith('?');
    if (claimed || dodged) {
      console.error(
        `[turn] ${claimed ? 'claim without successful write' : 'action request without write attempt'} — corrective pass`,
      );
      speech = await run(
        `${preamble}\n\n${correctionPrompt(audit, claimed ? 'claimed' : 'no_write')}`,
        correctionHistory(this.history, text, speech),
      );
    }
    // Navigation counts as a write for the claim check but moves no data, so
    // it must not flush the lens cache (a needless cold refetch next turn).
    if (hasSuccessfulWrite(audit.filter((a) => a.name !== UI_NAVIGATE))) {
      this.lens.clear();
    }

    // Record the exchange even if the client barged in — the tools already
    // ran, so the next turn's "it"/"that one" must still resolve against it.
    this.history = slideWindow(this.history, text, speech);
    if (signal.aborted) return;
    console.error(`[turn] reply: "${speech}"`);
    this.send({ type: 'assistant', text: speech });
    if (!speech || this.muted) return;

    this.send({ type: 'tts_start', sampleRate: this.tts.sampleRate });
    for await (const chunk of this.tts.synthesize(speech, signal)) {
      if (signal.aborted) return;
      this.send({ type: 'tts', audio: chunk.audio.toString('base64') });
    }
    this.send({ type: 'tts_end' });
  }
}

export interface VoiceServer {
  port: number;
  close(): Promise<void>;
}

/**
 * Pre-pay the session's one-time costs at boot instead of on the first
 * spoken turn: prime mlx_lm's prompt cache with the exact [system + tools]
 * prefix real turns use, and load the STT/TTS model weights.
 */
async function warmup(
  config: VoiceConfig,
  mcp: HolonsMcp,
  stt: STTProvider,
  tts: TTSProvider,
): Promise<void> {
  const t0 = Date.now();
  const jobs: Array<Promise<void>> = [];

  if (config.llm === 'local') {
    jobs.push(
      runAgentLoop({
        provider: makeLLM(config),
        tools: mcp.tools,
        // Stub dispatcher: warmup must never touch real data.
        dispatch: async (c) => ({ id: c.id, content: 'warmup', isError: false }),
        system: config.systemPrompt,
        prompt: 'Warmup ping. Reply with exactly: OK',
        maxIterations: 1,
      }).then(() => undefined),
    );
  }
  // 0.3s of silence, 16 kHz mono 16-bit WAV — enough to force model load.
  const silence = Buffer.alloc(44 + 9600);
  silence.write('RIFF', 0);
  silence.writeUInt32LE(36 + 9600, 4);
  silence.write('WAVEfmt ', 8);
  silence.writeUInt32LE(16, 16);
  silence.writeUInt16LE(1, 20);
  silence.writeUInt16LE(1, 22);
  silence.writeUInt32LE(16000, 24);
  silence.writeUInt32LE(32000, 28);
  silence.writeUInt16LE(2, 32);
  silence.writeUInt16LE(16, 34);
  silence.write('data', 36);
  silence.writeUInt32LE(9600, 40);
  jobs.push(stt.transcribe(silence, 'audio/wav').then(() => undefined));
  jobs.push(
    (async () => {
      const ac = new AbortController();
      for await (const _ of tts.synthesize('OK', ac.signal)) break;
    })(),
  );

  await Promise.allSettled(jobs);
  console.error(
    `[holons-voice] warmup done in ${((Date.now() - t0) / 1000).toFixed(1)}s (llm+stt+tts)`,
  );
}

export async function startVoiceServer(config: VoiceConfig): Promise<VoiceServer> {
  // One MCP subprocess shared across connections (single actor identity).
  const mcp = await connectHolonsMcp(config.mcp);
  if (config.toolPrefixes) {
    const total = mcp.tools.length;
    mcp.tools = mcp.tools.filter((t) =>
      config.toolPrefixes!.some((p) => t.name.startsWith(p)),
    );
    console.error(`[holons-voice] tools: ${mcp.tools.length}/${total} exposed to voice`);
  }
  // Client-side tools ride alongside the MCP tools on every model call —
  // including the warmup, so the primed prompt-cache prefix stays byte-stable
  // with real turns.
  mcp.tools = [...mcp.tools, uiNavigateTool];
  const stt = makeSTT(config);
  const tts = makeTTS(config);

  const wss = new WebSocketServer({ port: config.port });
  wss.on('connection', (ws) => new Session(ws, config, stt, tts, mcp));

  // Don't block listening on the warmup — but a turn that arrives mid-warmup
  // simply queues behind the same model loads it would have triggered itself.
  void warmup(config, mcp, stt, tts);

  return {
    port: config.port,
    close: () =>
      new Promise<void>((resolve) => {
        wss.close(() => {
          void mcp.close().finally(() => resolve());
        });
      }),
  };
}
