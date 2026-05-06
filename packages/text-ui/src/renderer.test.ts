import { describe, expect, it } from 'vitest';
import { formatResult } from './renderer.js';

describe('renderer.formatResult', () => {
  it('formats an ok status line', () => {
    expect(formatResult({ ok: true, message: 'done' })).toBe('[ok] done');
  });

  it('formats an error status line', () => {
    expect(formatResult({ ok: false, message: 'bad' })).toBe('[error] bad');
  });

  it('renders a list', () => {
    const out = formatResult({ ok: true, message: 'items', list: ['a', 'b'] });
    expect(out).toContain('  - a');
    expect(out).toContain('  - b');
  });

  it('renders a table with headers', () => {
    const out = formatResult({
      ok: true,
      message: 'rows',
      table: { headers: ['id', 'name'], rows: [['1', 'alice'], ['22', 'bob']] },
    });
    expect(out).toContain('id  name');
    expect(out).toMatch(/--\s+----/);
    expect(out).toContain('1   alice');
  });

  it('serializes data as JSON', () => {
    const out = formatResult({ ok: true, data: { x: 1 } });
    expect(out).toContain('"x": 1');
  });
});
