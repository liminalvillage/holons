// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { HistoryMessage } from '@holons/ai-ui';
import {
  MAX_HISTORY_CHARS,
  MAX_HISTORY_MESSAGES,
  MAX_MESSAGE_CHARS,
  slideWindow,
} from './history.js';

describe('slideWindow', () => {
  it('appends an exchange without mutating the input', () => {
    const before: HistoryMessage[] = [];
    const after = slideWindow(before, 'hi', 'hello');
    expect(before).toEqual([]);
    expect(after).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('records the user side even when the reply is empty', () => {
    const after = slideWindow([], 'do the thing', '  ');
    expect(after).toEqual([{ role: 'user', content: 'do the thing' }]);
  });

  it('drops oldest messages beyond the message cap', () => {
    let h: HistoryMessage[] = [];
    for (let i = 0; i < 20; i++) h = slideWindow(h, `q${i}`, `a${i}`);
    expect(h.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES);
    expect(h[h.length - 1]).toEqual({ role: 'assistant', content: 'a19' });
    expect(h.some((m) => m.content === 'q0')).toBe(false);
  });

  it('enforces the total char budget but keeps the newest exchange', () => {
    const long = 'x'.repeat(MAX_MESSAGE_CHARS);
    let h: HistoryMessage[] = [];
    for (let i = 0; i < 10; i++) h = slideWindow(h, long, long);
    const total = h.reduce((n, m) => n + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
    expect(h.length).toBeGreaterThanOrEqual(2);
  });

  it('clips oversized individual messages', () => {
    const h = slideWindow([], 'y'.repeat(5000), 'z');
    expect(h[0].content.length).toBe(MAX_MESSAGE_CHARS);
    expect(h[0].content.endsWith('…')).toBe(true);
  });
});
