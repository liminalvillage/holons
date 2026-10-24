// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('@holons/core/ai', async importOriginal => ({
  ...(await importOriginal()),
  createClaude: () => ({ beta: { messages: { create } } }),
}));

const {
  onboarding,
  forgetLiminalDocs,
  getQuestions,
  summarize,
  extractItemsFromImage,
} = await import('../src/AI.js');

const reply = (text, over = {}) => ({
  id: 'msg',
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  stop_details: null,
  content: [
    { type: 'thinking', thinking: '', signature: 's' },
    { type: 'text', text },
  ],
  ...over,
});

// Network: the docs (offline unless a test serves them) and OpenAI.
const fetchMock = vi.fn();
let docs = null;
const openaiAnswers = [];
const textResponse = text => ({ ok: true, text: async () => text });
const openaiReply = content => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] }),
});

beforeEach(() => {
  create.mockReset();
  delete process.env.HOLONS_AI_MODEL;
  delete process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = 'sk-test';
  forgetLiminalDocs();
  docs = null;
  openaiAnswers.length = 0;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async url => {
    if (url.startsWith('https://docs.liminalvillage.com/')) {
      if (docs === null) throw new Error('offline');
      return textResponse(docs);
    }
    return openaiReply(openaiAnswers.shift() ?? 'ok');
  });
  vi.stubGlobal('fetch', fetchMock);
});

const openaiCalls = () =>
  fetchMock.mock.calls
    .filter(([url]) => url === 'https://api.openai.com/v1/chat/completions')
    .map(([, init]) => ({ init, body: JSON.parse(init.body) }));

describe('onboarding agent', () => {
  it('answers on OpenAI and carries the whole conversation forward', async () => {
    openaiAnswers.push(' Use /task. ', 'Yes.');

    const first = await onboarding([], 'How do I add a task?');
    expect(first.text).toBe('Use /task.');
    const [firstReq] = openaiCalls();
    expect(firstReq.init.headers.authorization).toBe('Bearer sk-test');
    expect(firstReq.body.model).toBe('gpt-4o-mini');
    expect(firstReq.body.messages[0].role).toBe('system');
    expect(firstReq.body.messages[0].content).toContain('/appreciate');
    expect(create).not.toHaveBeenCalled();

    const second = await onboarding(first.history, 'And in a group?');
    expect(second.text).toBe('Yes.');
    expect(openaiCalls()[1].body.messages.map(m => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(second.history).toHaveLength(4);
  });

  it('answers from docs.liminalvillage.com, fetched once and cached', async () => {
    docs =
      '# Agent Instructions\nGET https://docs.liminalvillage.com/index.md?ask=\n\n---\n\n# Kitchen\nWash your dishes.';

    await onboarding([], 'Who washes the dishes?');
    await onboarding([], 'And the pots?');

    const docFetches = fetchMock.mock.calls.filter(([url]) =>
      url.startsWith('https://docs.liminalvillage.com/')
    );
    expect(docFetches.map(([url]) => url)).toEqual([
      'https://docs.liminalvillage.com/llms-full.txt',
    ]);
    const system = openaiCalls()[0].body.messages[0].content;
    expect(system).toContain('/appreciate');
    expect(system).toContain('# Kitchen\nWash your dishes.');
    expect(system).not.toContain('Agent Instructions');
  });

  it('falls back to the guide alone when the docs are unreachable', async () => {
    openaiAnswers.push('Use /task.');
    const answer = await onboarding([], 'How do I add a task?');
    expect(answer.text).toBe('Use /task.');
    expect(openaiCalls()[0].body.messages[0].content).not.toContain('<docs');
  });

  it('uses OPENAI_MODEL when set', async () => {
    process.env.OPENAI_MODEL = 'gpt-4.1';
    await onboarding([], 'hi');
    expect(openaiCalls()[0].body.model).toBe('gpt-4.1');
  });

  it('refuses without OPENAI_API_KEY', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(onboarding([], 'hi')).rejects.toMatchObject({
      kind: 'not_configured',
    });
  });
});

describe('getQuestions', () => {
  const catalogue = [
    { id: '1', topic: 'Governance', description: '…' },
    { id: '2', topic: 'Work Structure', description: '…' },
  ];

  it('constrains the answer to catalogue ids and keeps only those', async () => {
    create.mockResolvedValueOnce(
      reply('{"questions":[{"id":"2"},{"id":"99"},{"id":"1"}]}')
    );
    const result = await getQuestions('quiet place, shared meals', catalogue);
    expect(result.questions).toEqual([{ id: '2' }, { id: '1' }]);
    const [req] = create.mock.calls[0];
    const idSchema =
      req.output_config.format.schema.properties.questions.items.properties.id;
    expect(idSchema.enum).toEqual(['1', '2']);
    expect(req.system[0].text).toContain('Governance');
  });
});

describe('summarize', () => {
  it('returns the trimmed summary', async () => {
    create.mockResolvedValueOnce(reply('  Summary.\n'));
    expect(await summarize('a: hi\nb: hello\n')).toBe('Summary.');
  });
});

describe('extractItemsFromImage', () => {
  it('sends the photo as an image block and reads the items', async () => {
    create.mockResolvedValueOnce(
      reply('{"items":[{"name":"Hammer","value":8}]}')
    );
    const result = await extractItemsFromImage(Buffer.from('jpeg'), 'tools');
    expect(result).toEqual({ items: [{ name: 'Hammer', value: 8 }] });
    const [req] = create.mock.calls[0];
    expect(req.messages[0].content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg' },
    });
  });

  it('turns a provider failure into a message, not a throw', async () => {
    create.mockRejectedValueOnce(new Error('boom'));
    const result = await extractItemsFromImage(Buffer.from('jpeg'));
    expect(result.items).toEqual([]);
    expect(result.error).toMatch(/unavailable/);
  });
});
