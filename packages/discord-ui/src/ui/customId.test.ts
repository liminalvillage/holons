import { describe, it, expect } from 'vitest';
import { encodeCustomId, parseCustomId } from './customId.js';

describe('customId codec', () => {
  it('round-trips feature/action/args', () => {
    const id = encodeCustomId('quests', 'join', 'abc123');
    expect(id).toBe('quests:join:abc123');
    expect(parseCustomId(id)).toEqual({
      feature: 'quests',
      action: 'join',
      args: ['abc123'],
    });
  });

  it('supports multiple args and coerces numbers', () => {
    const id = encodeCustomId('shopping', 'toggle', 42, 'x');
    expect(parseCustomId(id)).toEqual({
      feature: 'shopping',
      action: 'toggle',
      args: ['42', 'x'],
    });
  });

  it('parses an action with no args', () => {
    expect(parseCustomId('quests:list')).toEqual({
      feature: 'quests',
      action: 'list',
      args: [],
    });
  });

  it('rejects segments containing the separator', () => {
    expect(() => encodeCustomId('quests', 'join', 'a:b')).toThrow();
  });

  it('rejects ids over the Discord 100-char limit', () => {
    expect(() => encodeCustomId('quests', 'join', 'x'.repeat(120))).toThrow();
  });

  it('returns null for malformed ids', () => {
    expect(parseCustomId('')).toBeNull();
    expect(parseCustomId('lonely')).toBeNull();
  });
});
