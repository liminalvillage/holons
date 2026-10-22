// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('@holons/core/ai', async importOriginal => ({
  ...(await importOriginal()),
  createClaude: () => ({ beta: { messages: { create } } }),
}));

const { onboarding, getQuestions, summarize, extractItemsFromImage } =
  await import('../src/AI.js');

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

beforeEach(() => {
  create.mockReset();
  delete process.env.HOLONS_AI_MODEL;
});

describe('onboarding agent', () => {
  it('answers from the guide and carries the whole conversation forward', async () => {
    create
      .mockResolvedValueOnce(reply(' Use /task. '))
      .mockResolvedValueOnce(reply('Yes.'));

    const first = await onboarding([], 'How do I add a task?');
    expect(first.text).toBe('Use /task.');
    const [firstReq] = create.mock.calls[0];
    expect(firstReq.model).toBe('claude-opus-5-5');
    expect(firstReq.output_config).toEqual({ effort: 'low' });
    expect(firstReq.system[0].text).toContain('/appreciate');
    expect(firstReq.system[0].cache_control).toEqual({ type: 'ephemeral' });

    const second = await onboarding(first.history, 'And in a group?');
    const [secondReq] = create.mock.calls[1];
    // Append-only: the first answer goes back whole, thinking included.
    expect(secondReq.messages.map(m => m.role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
    expect(secondReq.messages[1].content[0].type).toBe('thinking');
    expect(second.history).toHaveLength(4);
  });

  it('uses HOLONS_AI_MODEL when set', async () => {
    process.env.HOLONS_AI_MODEL = 'claude-sonnet-5-5';
    create.mockResolvedValueOnce(reply('ok'));
    await onboarding([], 'hi');
    expect(create.mock.calls[0][0].model).toBe('claude-sonnet-5-5');
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
