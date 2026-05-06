import { describe, expect, it } from 'vitest';
import { parseArgv, parseLine } from './parser.js';

describe('parser', () => {
  it('returns null on empty input', () => {
    expect(parseArgv([])).toBeNull();
    expect(parseLine('')).toBeNull();
  });

  it('parses --key=value pairs', () => {
    const r = parseArgv(['createTask', '--holonId=acme', '--title=ship it']);
    expect(r).toEqual({
      command: 'createTask',
      params: { holonId: 'acme', title: 'ship it' },
      positional: [],
    });
  });

  it('parses --key value pairs with look-ahead', () => {
    const r = parseArgv(['logHours', '--taskId', 't1', '--hours', '2.5']);
    expect(r?.params).toEqual({ taskId: 't1', hours: 2.5 });
  });

  it('coerces numbers and booleans', () => {
    const r = parseArgv(['cmd', '--count=42', '--active=true']);
    expect(r?.params).toEqual({ count: 42, active: true });
  });

  it('handles bare flags and --no-flag', () => {
    const r = parseArgv(['cmd', '--verbose', '--no-cache']);
    expect(r?.params).toEqual({ verbose: true, cache: false });
  });

  it('tokenizes quoted REPL input', () => {
    const r = parseLine('createTask --title "ship it" --holonId=acme');
    expect(r?.params).toEqual({ title: 'ship it', holonId: 'acme' });
  });
});
