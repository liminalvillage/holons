import { describe, expect, it } from 'vitest';
import { colorFromCategory, getColorFromCategory } from './colors.js';

describe('colorFromCategory', () => {
  it('returns the task default for empty category', () => {
    expect(colorFromCategory(undefined)).toBe('#E5E7EB');
    expect(colorFromCategory(null)).toBe('#E5E7EB');
    expect(colorFromCategory('')).toBe('#E5E7EB');
  });

  it('returns type-specific defaults when category is empty', () => {
    expect(colorFromCategory(undefined, 'event')).toBe('hsl(280, 70%, 85%)');
    expect(colorFromCategory(undefined, 'quest')).toBe('hsl(200, 70%, 85%)');
  });

  it('returns dark-mode defaults when dark=true', () => {
    expect(colorFromCategory(undefined, 'task', true)).toBe('#1f2937');
    expect(colorFromCategory(undefined, 'event', true)).toBe('hsl(280, 25%, 22%)');
    expect(colorFromCategory(undefined, 'quest', true)).toBe('hsl(200, 25%, 22%)');
  });

  it('is deterministic — same input yields same output', () => {
    const a = colorFromCategory('food');
    const b = colorFromCategory('food');
    expect(a).toBe(b);
  });

  it('produces hue from category hash for task/event/quest in light mode', () => {
    // Hash of 'food' -> hue 334 (matches the inline implementation that
    // both UIs previously copy-pasted).
    expect(colorFromCategory('food', 'task')).toBe('hsl(334, 70%, 85%)');
    expect(colorFromCategory('food', 'event')).toBe('hsl(334, 85%, 80%)');
    expect(colorFromCategory('food', 'quest')).toBe('hsl(334, 75%, 82%)');
  });

  it('produces dark-mode hued colors for non-empty category', () => {
    expect(colorFromCategory('food', 'task', true)).toBe('hsl(334, 25%, 22%)');
    expect(colorFromCategory('food', 'event', true)).toBe('hsl(334, 30%, 24%)');
    expect(colorFromCategory('food', 'quest', true)).toBe('hsl(334, 28%, 24%)');
  });

  it('falls back to task palette for unknown types', () => {
    expect(colorFromCategory('food', 'recurring')).toBe(colorFromCategory('food', 'task'));
  });

  it('exposes getColorFromCategory as an alias', () => {
    expect(getColorFromCategory).toBe(colorFromCategory);
  });
});
