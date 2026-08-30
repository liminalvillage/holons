import { describe, it, expect } from 'vitest';
import { createTrustCache, parseDuration } from '../src/createHoloSphere.js';

describe('parseDuration', () => {
  it('reads seconds and s/m/h/d suffixes', () => {
    expect(parseDuration('3600')).toBe(3600);
    expect(parseDuration('30m')).toBe(1800);
    expect(parseDuration('12h')).toBe(43200);
    expect(parseDuration('7d')).toBe(604800);
    expect(parseDuration('')).toBeUndefined();
    expect(parseDuration('soon')).toBeUndefined();
    expect(parseDuration('0d')).toBeUndefined();
  });
});

describe('createTrustCache', () => {
  it('trusts the holon key alone without an instance or secret', async () => {
    const trust = createTrustCache('a'.repeat(64), '');
    expect(await trust.trustedAuthors('-1')).toEqual(['a'.repeat(64)]);
    expect(trust.userIdFor('b'.repeat(64))).toBeUndefined();
  });
});
