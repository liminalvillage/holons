// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { formatUiContext } from './context.js';

describe('formatUiContext', () => {
  it('returns empty string for missing/invalid context', () => {
    expect(formatUiContext(undefined)).toBe('');
    expect(formatUiContext(null)).toBe('');
    expect(formatUiContext('holon 1')).toBe('');
    expect(formatUiContext(['a'])).toBe('');
    expect(formatUiContext({})).toBe('');
    expect(formatUiContext({ holon: 42 })).toBe(''); // non-string values dropped
  });

  it('renders string entries and steers to the context holon', () => {
    const s = formatUiContext({ holon: '-100123', view: 'tasks' });
    expect(s).toContain('holon: -100123');
    expect(s).toContain('view: tasks');
    expect(s).toContain('not their personal holon');
  });

  it('drops blank values and caps entry count and value length', () => {
    const big: Record<string, string> = { blank: '  ' };
    for (let i = 0; i < 20; i++) big[`k${i}`] = 'v'.repeat(500);
    const s = formatUiContext(big);
    expect(s).not.toContain('blank');
    expect(s).not.toContain('k15'); // beyond the 12-entry cap
    expect(s).toContain('k0: ' + 'v'.repeat(200));
    expect(s).not.toContain('v'.repeat(201));
  });
});
