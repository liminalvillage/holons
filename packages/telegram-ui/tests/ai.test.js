// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('openai', () => ({
  default: class {
    constructor() {
      this.responses = { create };
    }
  },
}));

const { onboarding, getQuestions, summarize } = await import('../src/AI.js');

beforeEach(() => {
  create.mockReset();
  delete process.env.OPENAI_MODEL;
});

describe('onboarding agent', () => {
  it('answers from the guide and continues the conversation by response id', async () => {
    create
      .mockResolvedValueOnce({ id: 'resp_1', output_text: ' Use /task. ' })
      .mockResolvedValueOnce({ id: 'resp_2', output_text: 'Yes.' });

    const first = await onboarding(null, 'How do I add a task?');
    expect(first).toEqual({ responseId: 'resp_1', text: 'Use /task.' });
    const [firstReq] = create.mock.calls[0];
    expect(firstReq.model).toBe('gpt-4o');
    expect(firstReq.input).toBe('How do I add a task?');
    expect(firstReq.instructions).toContain('/appreciate');
    expect(firstReq).not.toHaveProperty('previous_response_id');

    await onboarding(first.responseId, 'And in a group?');
    const [secondReq] = create.mock.calls[1];
    expect(secondReq.previous_response_id).toBe('resp_1');
    expect(secondReq.instructions).toBe(firstReq.instructions);
  });

  it('uses OPENAI_MODEL when set', async () => {
    process.env.OPENAI_MODEL = 'gpt-test';
    create.mockResolvedValueOnce({ id: 'r', output_text: 'ok' });
    await onboarding(null, 'hi');
    expect(create.mock.calls[0][0].model).toBe('gpt-test');
  });
});

describe('getQuestions', () => {
  const catalogue = [
    { id: '1', topic: 'Governance', description: '…' },
    { id: '2', topic: 'Work Structure', description: '…' },
  ];

  it('asks for JSON and keeps only ids from the catalogue', async () => {
    create.mockResolvedValueOnce({
      id: 'r',
      output_text: '{"questions":[{"id":"2"},{"id":"99"},{"id":1}]}',
    });
    const result = await getQuestions('quiet place, shared meals', catalogue);
    expect(result.questions).toEqual([{ id: '2' }, { id: '1' }]);
    const [req] = create.mock.calls[0];
    expect(req.text).toEqual({ format: { type: 'json_object' } });
    expect(req.instructions).toContain('Governance');
  });
});

describe('summarize', () => {
  it('returns the trimmed summary', async () => {
    create.mockResolvedValueOnce({ id: 'r', output_text: '  Summary.\n' });
    expect(await summarize('a: hi\nb: hello\n')).toBe('Summary.');
  });
});
