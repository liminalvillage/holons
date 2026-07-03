// Runtime configuration for the voice harness.
//
// One master switch VOICE_PROVIDER=api|local (default `api`) selects every leg,
// with per-leg overrides LLM_PROVIDER / STT_PROVIDER / TTS_PROVIDER. "api" is
// the default so a fresh checkout runs against hosted models with no local
// model management; "local" swaps in mlx_lm.server + whisper.cpp + kokoro-js.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export type Leg = 'api' | 'local';

export interface McpLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface VoiceConfig {
  port: number;
  llm: Leg;
  stt: Leg;
  tts: Leg;

  // API-leg credentials.
  anthropicApiKey?: string;
  anthropicModel: string;
  openaiApiKey?: string;

  // Local-leg (OpenAI-compatible) LLM endpoint, e.g. mlx_lm.server.
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;

  // STT / TTS model + voice selection (used by whichever leg is active).
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;

  mcp: McpLaunch;

  systemPrompt: string;

  /**
   * MCP tool-name prefixes exposed to the voice agent, or null for all.
   * Every tool schema rides along on EVERY model call, so trimming exotic
   * domains directly cuts prompt-processing latency on the local leg.
   */
  toolPrefixes: string[] | null;
}

const DEFAULT_SYSTEM_PROMPT =
  'You are the Holons voice agent. You operate a Holons holarchy through tools. ' +
  'Prefer acting via tools over describing. Keep spoken replies short and natural — ' +
  'one or two sentences — since they are read aloud. Confirm before destructive actions. ' +
  'Tools with a `persist` parameter only SAVE when you pass persist: true — without it ' +
  'the record is built but discarded. When the user asks to create or change something, ' +
  'always pass persist: true, and check the tool result: only report success when it ' +
  'shows persisted: true. ' +
  'Record ids are opaque codes like "mr3zld0hzsc" — always copy them EXACTLY from the ' +
  'live state or a lens listing; a number or a title is never a valid id. ' +
  'Never guess or invent record ids. When the user refers to an existing record by name ' +
  '(complete/edit/join/delete a task, borrow a library item, …), FIRST find it: call ' +
  'lens_get_all on the holon with the right lens (tasks → "quests", library → "library", ' +
  'shopping → "shopping", roles → "roles"), pick the item whose title best matches what ' +
  'was said (spoken words may be transcribed imperfectly — match loosely), THEN call the ' +
  'action tool (e.g. task_complete) with that item\'s exact id. If several match, ask ' +
  'which one; if none match, say so. ' +
  'Always work out what the user actually wants done and execute the FULL combination of ' +
  'tool calls that fulfills it — find, then act, then any follow-up the request implies ' +
  '(e.g. "finish the roof task and add me" = find the task, complete it, add the ' +
  'participant). Do not stop after the first call, do not announce what you are about to ' +
  'do instead of doing it, and do not hand work back to the user that a tool can do. ' +
  'Speak like a human, never like a database: refer to records only by their content — ' +
  'mainly the title ("the cleaning rooms task"), never by id, and never read out JSON, ' +
  'field names, or raw tool output. Summarize results in plain spoken language. ' +
  'Recipe — subtasks: find the task in lens "quests", then call subtask_add with the ' +
  'task\'s id as checklistId — it resolves the task\'s checklist (creating and linking ' +
  'one if needed) automatically. ' +
  'Recipe — deleting: there is no task_delete tool. To delete a task, find it in lens ' +
  '"quests" and call lens_delete with lens "quests" and its id. ' +
  'Recipe — scheduling/editing: use task_update to change a task\'s when/until (full ' +
  'ISO 8601 local timestamps computed from the current date/time given above), title, ' +
  'description, or category. ' +
  'Honesty: only claim an action happened if a tool call SUCCEEDED this turn. If a tool ' +
  'failed or you called none, say so plainly and say what went wrong — never pretend.';

function leg(env: NodeJS.ProcessEnv, key: string, fallback: Leg): Leg {
  const v = env[key]?.trim().toLowerCase();
  return v === 'api' || v === 'local' ? v : fallback;
}

/**
 * Default tool families for spoken interaction. Drops the exotic domains
 * (dna/chromosome/scoring/settings/federation/…) a voice user won't reach;
 * set VOICE_TOOLS=all (or a custom comma list of prefixes) to override.
 */
const DEFAULT_TOOL_PREFIXES = [
  'task',
  'subtask',
  'checklist',
  'shopping',
  'library',
  'lens',
  'user',
  'holon',
  'calendar',
  'reminder',
  'role',
  'announcement',
  'expense',
  'tag',
];

function toolPrefixes(env: NodeJS.ProcessEnv): string[] | null {
  const raw = env.VOICE_TOOLS?.trim();
  if (!raw) return DEFAULT_TOOL_PREFIXES;
  if (raw.toLowerCase() === 'all') return null;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Default path to the built mcp-ui server, resolved relative to this package. */
function defaultMcpEntry(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // packages/voice-ui/(src|dist)
  return resolve(here, '..', '..', 'mcp-ui', 'dist', 'index.js');
}

/** Forward the Holons actor identity + any HOLONS_* vars to the MCP subprocess. */
function actorEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith('HOLONS_') && v !== undefined) out[k] = v;
  }
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): VoiceConfig {
  const master = leg(env, 'VOICE_PROVIDER', 'api');

  const mcpCommand = env.HOLONS_MCP_COMMAND?.trim() || process.execPath; // node
  const mcpArgs = env.HOLONS_MCP_ARGS?.trim()
    ? env.HOLONS_MCP_ARGS.trim().split(/\s+/)
    : [defaultMcpEntry()];

  // Tell the LLM who the user is, so "my holon" resolves to their own ID
  // instead of a guessed literal like "user_id".
  const actorId = env.HOLONS_ACTOR_ID?.trim();
  const actorName = env.HOLONS_ACTOR_NAME?.trim();
  const actorUser = env.HOLONS_ACTOR_USERNAME?.trim();
  const identity = actorId
    ? ` The current user is ${actorName || actorUser || 'the user'}` +
      `${actorUser ? ` (@${actorUser})` : ''}, user ID ${actorId}. Their personal ` +
      `holon is holon ID ${actorId}; whenever they say "my holon", "my personal ` +
      `holon", or "me", use holon ID ${actorId}. Never ask the user for a holon ` +
      `ID you can infer this way, and never invent placeholder IDs like "user_id".`
    : '';
  // Qwen3 is a hybrid "thinking" model: by default it emits a chain-of-thought
  // before every answer, which — doubled by the tool-use loop — dominates the
  // voice latency. The `/no_think` soft switch disables it for short spoken
  // replies. Applied only on the local leg (Qwen); harmless string otherwise.
  const llmLeg = leg(env, 'LLM_PROVIDER', master);
  const noThink = llmLeg === 'local' ? ' /no_think' : '';
  const systemPrompt =
    (env.VOICE_SYSTEM_PROMPT?.trim() || DEFAULT_SYSTEM_PROMPT) + identity + noThink;

  return {
    port: Number(env.VOICE_PORT ?? 8787),
    llm: llmLeg,
    stt: leg(env, 'STT_PROVIDER', master),
    tts: leg(env, 'TTS_PROVIDER', master),

    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicModel: env.HOLONS_AI_MODEL?.trim() || 'claude-sonnet-4-6',
    openaiApiKey: env.OPENAI_API_KEY,

    llmBaseUrl: env.LLM_BASE_URL?.trim() || 'http://localhost:1234/v1',
    llmApiKey: env.LLM_API_KEY?.trim() || 'local',
    llmModel: env.LLM_MODEL?.trim() || 'mlx-community/Qwen3-30B-A3B-4bit',

    sttModel: env.STT_MODEL?.trim() || (master === 'local' ? 'base.en' : 'whisper-1'),
    ttsModel: env.TTS_MODEL?.trim() || (master === 'local' ? 'onnx-community/Kokoro-82M-v1.0-ONNX' : 'tts-1'),
    ttsVoice: env.TTS_VOICE?.trim() || (master === 'local' ? 'af_heart' : 'alloy'),

    mcp: { command: mcpCommand, args: mcpArgs, env: actorEnv(env) },

    systemPrompt,

    toolPrefixes: toolPrefixes(env),
  };
}
