// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { normalizeHolonName, saveHolonName } from './name.js';

describe('normalizeHolonName', () => {
  it('trims, collapses whitespace and caps the length', () => {
    expect(normalizeHolonName('  Casa   Selva \n', 'h1')).toBe('Casa Selva');
    expect(normalizeHolonName('x'.repeat(200), 'h1')).toHaveLength(64);
  });

  it('refuses what is not a name', () => {
    expect(normalizeHolonName('', 'h1')).toBe('');
    expect(normalizeHolonName('   ', 'h1')).toBe('');
    expect(normalizeHolonName(42, 'h1')).toBe('');
    expect(normalizeHolonName('-1003864542239', '-1003864542239')).toBe('');
    expect(normalizeHolonName('My Holon', 'h1')).toBe('');
    expect(normalizeHolonName('Holon h1', 'h1')).toBe('');
  });
});

describe('saveHolonName', () => {
  function fakeHs(existing: any, opts: { getFails?: boolean } = {}) {
    const puts: any[] = [];
    return {
      puts,
      async get() {
        if (opts.getFails) throw new Error('relay down');
        return existing;
      },
      async put(_holon: string, _lens: string, doc: any) {
        puts.push(doc);
      },
    };
  }

  it('merges the name over the existing document and never touches the id', async () => {
    const hs = fakeHs({ id: 'h1', name: 'Casa', language: 'it', color: '#aabbcc' });
    expect(await saveHolonName(hs as any, 'h1', '  Casa Selva ')).toBe('Casa Selva');
    expect(hs.puts).toEqual([{ id: 'h1', name: 'Casa Selva', language: 'it', color: '#aabbcc' }]);
  });

  it('writes nothing for a blank or stand-in name', async () => {
    const hs = fakeHs({ id: 'h1', name: 'Casa' });
    expect(await saveHolonName(hs as any, 'h1', '  ')).toBe('');
    expect(await saveHolonName(hs as any, 'h1', 'h1')).toBe('');
    expect(hs.puts).toEqual([]);
  });

  it('still writes when the read fails', async () => {
    const hs = fakeHs(null, { getFails: true });
    await saveHolonName(hs as any, 'h1', 'Liminal');
    expect(hs.puts).toEqual([{ id: 'h1', name: 'Liminal' }]);
  });
});
