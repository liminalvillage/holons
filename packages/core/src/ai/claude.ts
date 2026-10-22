// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one way Holons talks to a language model: Claude, through the official
// SDK, server-side only. Every surface that writes or reads text with a model
// (the web/kiosk routes, the bot, the agents) goes through here, so the key,
// the model, the refusal fallback, structured output and the error mapping
// are decided once. Speech (STT/TTS/realtime voice) stays with OpenAI and is
// not part of this module.
//
// Configuration, read from whatever env object the caller hands in:
//   ANTHROPIC_API_KEY   the key (server-side only — never a VITE_ name)
//   HOLONS_AI_MODEL     overrides AI_DEFAULT_MODEL

import Anthropic from '@anthropic-ai/sdk';

export const AI_DEFAULT_MODEL = 'claude-opus-5-5';

/** How hard the model thinks: cheap routes low, real reasoning higher. */
export type AIEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type AIEnv = Record<string, string | undefined>;

/**
 * Models that take the server-side refusal fallback (`fallbacks: "default"`):
 * when a safety classifier declines, the API re-runs the request on a model
 * that can answer, inside the same call.
 */
const FALLBACK_MODELS = new Set([
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-fable-5-1',
  'claude-sonnet-5-5',
]);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export function aiApiKey(env: AIEnv): string {
  return (env.ANTHROPIC_API_KEY ?? '').trim();
}

export function aiModel(env: AIEnv): string {
  return (env.HOLONS_AI_MODEL ?? '').trim() || AI_DEFAULT_MODEL;
}

export function aiConfigured(env: AIEnv): boolean {
  return aiApiKey(env) !== '';
}

/** A Claude client for this env. Throws `not_configured` without a key. */
export function createClaude(env: AIEnv): Anthropic {
  const apiKey = aiApiKey(env);
  if (!apiKey) {
    throw new AIError('not_configured', 'ANTHROPIC_API_KEY is not set.');
  }
  return new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
}

export type AIErrorKind =
  | 'not_configured'
  | 'auth'
  | 'rate_limit'
  | 'unavailable'
  | 'rejected'
  | 'refusal'
  | 'truncated'
  | 'invalid_output'
  | 'failed';

/** What a route answers for each kind: status + a line a person can read. */
const KIND_RESPONSE: Record<AIErrorKind, { status: number; message: string }> = {
  not_configured: { status: 503, message: 'AI is not configured on this server.' },
  auth: { status: 502, message: 'The AI provider rejected the configured API key.' },
  rate_limit: { status: 429, message: 'The AI provider is busy — try again shortly.' },
  unavailable: { status: 503, message: 'The AI provider is unavailable — try again shortly.' },
  rejected: { status: 502, message: 'The AI provider rejected the request.' },
  refusal: { status: 422, message: 'The AI declined to answer this request.' },
  truncated: { status: 502, message: 'The AI answer was cut short.' },
  invalid_output: { status: 502, message: 'The AI returned an answer that could not be read.' },
  failed: { status: 500, message: 'The AI request failed.' },
};

export class AIError extends Error {
  readonly kind: AIErrorKind;
  constructor(kind: AIErrorKind, message?: string, options?: { cause?: unknown }) {
    super(message ?? KIND_RESPONSE[kind].message, options);
    this.name = 'AIError';
    this.kind = kind;
  }
  /** The HTTP status a route should answer with. */
  get status(): number {
    return KIND_RESPONSE[this.kind].status;
  }
  /** The message a route should show — never the provider's raw detail. */
  get publicMessage(): string {
    return KIND_RESPONSE[this.kind].message;
  }
}

/** Any thrown value → an AIError, most specific SDK class first. */
export function toAIError(err: unknown): AIError {
  if (err instanceof AIError) return err;
  const wrap = (kind: AIErrorKind) =>
    new AIError(kind, err instanceof Error ? err.message : String(err), { cause: err });
  if (err instanceof Anthropic.AuthenticationError) return wrap('auth');
  if (err instanceof Anthropic.PermissionDeniedError) return wrap('auth');
  if (err instanceof Anthropic.RateLimitError) return wrap('rate_limit');
  if (err instanceof Anthropic.InternalServerError) return wrap('unavailable');
  if (err instanceof Anthropic.APIConnectionError) return wrap('unavailable');
  if (err instanceof Anthropic.BadRequestError) return wrap('rejected');
  if (err instanceof Anthropic.NotFoundError) return wrap('rejected');
  if (err instanceof Anthropic.APIError) {
    return wrap(err.status === 529 ? 'unavailable' : 'failed');
  }
  return wrap('failed');
}

export interface CompleteOptions {
  client: Anthropic;
  model: string;
  /** Stable instructions — kept first so they can be cached. */
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  effort?: AIEffort;
  maxTokens?: number;
  /** A JSON schema the answer must follow (structured output). */
  schema?: Record<string, unknown>;
  /** Cache the system prompt (worth it when it is long and reused). */
  cacheSystem?: boolean;
  /** Tools the model may call (rendered before the system prompt, so a
   *  cached system prompt caches them too). */
  tools?: Anthropic.Beta.BetaToolUnion[];
}

export interface CompleteResult {
  /** The answer's text (all text blocks, joined). */
  text: string;
  /** The full assistant content — append THIS to continue a conversation. */
  content: Anthropic.Beta.BetaContentBlock[];
  /** The model that actually answered (a fallback model, after a refusal). */
  model: string;
  /** Why the turn ended — `tool_use` means the tools want running. */
  stopReason: Anthropic.Beta.BetaStopReason | null;
}

/**
 * One Claude turn. Refusals and cut-off answers throw (`refusal`,
 * `truncated`) instead of returning a half answer; provider failures come
 * back as AIError with the kind a route can map to a status.
 */
export async function complete(opts: CompleteOptions): Promise<CompleteResult> {
  const fallback = FALLBACK_MODELS.has(opts.model);
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await opts.client.beta.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 16000,
      system: [
        {
          type: 'text',
          text: opts.system,
          ...(opts.cacheSystem ? { cache_control: { type: 'ephemeral' as const } } : {}),
        },
      ],
      messages: opts.messages,
      ...(opts.tools?.length ? { tools: opts.tools } : {}),
      output_config: {
        effort: opts.effort ?? 'medium',
        ...(opts.schema ? { format: { type: 'json_schema' as const, schema: opts.schema } } : {}),
      },
      ...(fallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
    });
  } catch (err) {
    throw toAIError(err);
  }

  if (response.stop_reason === 'refusal') {
    throw new AIError('refusal', response.stop_details?.explanation ?? undefined);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new AIError('truncated');
  }
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return {
    text,
    content: response.content,
    model: response.model,
    stopReason: response.stop_reason,
  };
}

/** One structured-output turn: the parsed JSON answer + the model used. */
export async function completeJSON(
  opts: Omit<CompleteOptions, 'messages'> & {
    schema: Record<string, unknown>;
    user: string | Anthropic.Beta.BetaContentBlockParam[];
  },
): Promise<{ output: unknown; model: string }> {
  const { user, ...rest } = opts;
  const result = await complete({ ...rest, messages: [{ role: 'user', content: user }] });
  try {
    return { output: JSON.parse(result.text), model: result.model };
  } catch (err) {
    throw new AIError('invalid_output', 'The answer was not valid JSON.', { cause: err });
  }
}
