// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {
  AI_DEFAULT_MODEL,
  AIError,
  aiConfigured,
  aiModel,
  complete,
  completeJSON,
  createClaude,
  toAIError,
} from './claude.js';

/** A client whose one call returns `reply` (or throws it). */
function fakeClient(reply: unknown) {
  const create = vi.fn(async () => {
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

const message = (over: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  model: AI_DEFAULT_MODEL,
  stop_reason: 'end_turn',
  stop_details: null,
  content: [
    { type: 'thinking', thinking: '', signature: 'sig' },
    { type: 'text', text: ' Hello. ' },
  ],
  ...over,
});

describe('configuration', () => {
  it('reads only the server-side key, and the model override', () => {
    expect(aiConfigured({})).toBe(false);
    expect(aiConfigured({ VITE_ANTHROPIC_API_KEY: 'k' })).toBe(false);
    expect(aiConfigured({ ANTHROPIC_API_KEY: ' k ' })).toBe(true);
    expect(aiModel({})).toBe('claude-opus-5-5');
    expect(aiModel({ HOLONS_AI_MODEL: 'claude-sonnet-5-5' })).toBe('claude-sonnet-5-5');
  });

  it('refuses to build a client without a key', () => {
    expect(() => createClaude({})).toThrow(AIError);
    try {
      createClaude({});
    } catch (err) {
      expect((err as AIError).kind).toBe('not_configured');
      expect((err as AIError).status).toBe(503);
    }
  });
});

describe('complete', () => {
  it('sends effort, the cached system prompt and the refusal fallback', async () => {
    const { client, create } = fakeClient(message());
    const result = await complete({
      client,
      model: AI_DEFAULT_MODEL,
      system: 'Be brief.',
      messages: [{ role: 'user', content: 'Hi' }],
      effort: 'low',
      cacheSystem: true,
    });
    expect(result.text).toBe('Hello.');
    // The whole content comes back, thinking included, to append as-is.
    expect(result.content).toHaveLength(2);
    const [req] = create.mock.calls[0] as unknown as [Record<string, any>];
    expect(req.output_config).toEqual({ effort: 'low' });
    expect(req.system[0]).toMatchObject({ text: 'Be brief.', cache_control: { type: 'ephemeral' } });
    expect(req.fallbacks).toBe('default');
    expect(req.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(req).not.toHaveProperty('temperature');
    expect(req).not.toHaveProperty('thinking');
  });

  it('leaves the fallback off for a model that does not take it', async () => {
    const { client, create } = fakeClient(message());
    await complete({ client, model: 'claude-haiku-5-5', system: 's', messages: [] });
    const [req] = create.mock.calls[0] as unknown as [Record<string, any>];
    expect(req).not.toHaveProperty('fallbacks');
    expect(req).not.toHaveProperty('betas');
  });

  it('throws on a refusal or a cut-off answer instead of returning half of it', async () => {
    const refused = fakeClient(
      message({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: 'no' } }),
    );
    await expect(
      complete({ client: refused.client, model: AI_DEFAULT_MODEL, system: 's', messages: [] }),
    ).rejects.toMatchObject({ kind: 'refusal', status: 422 });

    const cut = fakeClient(message({ stop_reason: 'max_tokens' }));
    await expect(
      complete({ client: cut.client, model: AI_DEFAULT_MODEL, system: 's', messages: [] }),
    ).rejects.toMatchObject({ kind: 'truncated' });
  });
});

describe('completeJSON', () => {
  const schema = { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string' } } };

  it('asks for the schema and parses the answer', async () => {
    const { client, create } = fakeClient(message({ content: [{ type: 'text', text: '{"a":"x"}' }] }));
    const { output } = await completeJSON({ client, model: AI_DEFAULT_MODEL, system: 's', user: 'u', schema });
    expect(output).toEqual({ a: 'x' });
    const [req] = create.mock.calls[0] as unknown as [Record<string, any>];
    expect(req.output_config.format).toEqual({ type: 'json_schema', schema });
    expect(req.messages).toEqual([{ role: 'user', content: 'u' }]);
  });

  it('reports unreadable JSON as invalid_output', async () => {
    const { client } = fakeClient(message({ content: [{ type: 'text', text: 'not json' }] }));
    await expect(
      completeJSON({ client, model: AI_DEFAULT_MODEL, system: 's', user: 'u', schema }),
    ).rejects.toMatchObject({ kind: 'invalid_output', status: 502 });
  });
});

describe('toAIError', () => {
  const headers = new Headers();
  it('maps the SDK error classes to kinds a route can answer', () => {
    const cases: Array<[unknown, string, number]> = [
      [new Anthropic.AuthenticationError(401, undefined, 'bad key', headers), 'auth', 502],
      [new Anthropic.RateLimitError(429, undefined, 'slow down', headers), 'rate_limit', 429],
      [new Anthropic.InternalServerError(500, undefined, 'boom', headers), 'unavailable', 503],
      [new Anthropic.BadRequestError(400, undefined, 'bad', headers), 'rejected', 502],
      [new Error('other'), 'failed', 500],
    ];
    for (const [err, kind, status] of cases) {
      const mapped = toAIError(err);
      expect(mapped.kind).toBe(kind);
      expect(mapped.status).toBe(status);
      // The provider's raw detail never reaches the public message.
      expect(mapped.publicMessage).not.toContain('bad key');
    }
  });
});
