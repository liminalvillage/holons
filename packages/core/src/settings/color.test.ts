import { describe, expect, it } from 'vitest';
import {
  colorHash,
  holonColor,
  normalizeHolonColor,
  pickColor,
  readHolonColor,
  saveHolonColor,
} from './color.js';
import { parseHolonSettings } from './persistence.js';

const PALETTE = ['sun', 'mint', 'sky', 'coral', 'lav', 'lime'] as const;

describe('colorHash', () => {
  it('is stable for the same seed and differs across seeds', () => {
    expect(colorHash('-1003864542239')).toBe(colorHash('-1003864542239'));
    expect(colorHash('-1003864542239')).not.toBe(colorHash('-1001652773351'));
  });

  it('is non-negative and treats a blank seed as "•"', () => {
    for (const id of ['', 'a', '-100123', 'liminal', '235114395']) {
      expect(colorHash(id)).toBeGreaterThanOrEqual(0);
    }
    expect(colorHash('')).toBe(colorHash('•'));
    expect(colorHash(undefined)).toBe(colorHash('•'));
  });

  it('is the kiosk post-it hash, bit for bit', () => {
    // The reference implementation the kiosk's noteColor() used before the
    // move into core — any drift here would recolour every category.
    const ref = (s: string) => {
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
      return Math.abs(h);
    };
    for (const seed of ['garden', 'kitchen', 'Manutenzione', '-1003864542239'])
      expect(colorHash(seed)).toBe(ref(seed));
  });
});

describe('pickColor', () => {
  it('indexes the palette by the hash', () => {
    const c = pickColor('garden', PALETTE);
    expect(PALETTE).toContain(c);
    expect(c).toBe(PALETTE[colorHash('garden') % PALETTE.length]);
  });

  it('returns "" for an empty palette', () => {
    expect(pickColor('garden', [])).toBe('');
  });
});

describe('normalizeHolonColor', () => {
  it('accepts hex, expands shorthand, lowercases', () => {
    expect(normalizeHolonColor('#0E6B66')).toBe('#0e6b66');
    expect(normalizeHolonColor('0e6b66')).toBe('#0e6b66');
    expect(normalizeHolonColor('#ABC')).toBe('#aabbcc');
    expect(normalizeHolonColor('  #abc  ')).toBe('#aabbcc');
  });

  it('rejects anything that is not a plain hex colour', () => {
    expect(normalizeHolonColor('red')).toBe('');
    expect(normalizeHolonColor('hsl(10 50% 50%)')).toBe('');
    expect(normalizeHolonColor('#12345')).toBe('');
    expect(normalizeHolonColor(null)).toBe('');
    expect(normalizeHolonColor(undefined)).toBe('');
    expect(normalizeHolonColor(42)).toBe('');
  });
});

describe('readHolonColor', () => {
  it('reads the override off a settings document', () => {
    expect(readHolonColor({ id: 'h1', color: '#FF8800' })).toBe('#ff8800');
  });

  it('returns "" for a missing or invalid field', () => {
    expect(readHolonColor({ id: 'h1' })).toBe('');
    expect(readHolonColor({ id: 'h1', color: 'blue' })).toBe('');
    expect(readHolonColor(null)).toBe('');
  });

  it('tolerates the array shape of the settings lens', () => {
    expect(readHolonColor([{ id: 'x' }, { id: 'h1', color: '#123456' }])).toBe('#123456');
    expect(readHolonColor([])).toBe('');
  });
});

describe('holonColor', () => {
  it('picks the palette entry the id hashes to when nothing is configured', () => {
    const c = holonColor('-1003864542239', PALETTE);
    expect(PALETTE).toContain(c);
    expect(holonColor('-1003864542239', PALETTE)).toBe(c);
    // Same algorithm as a card's category colour.
    expect(c).toBe(pickColor('-1003864542239', PALETTE));
  });

  it('prefers the caretaker override, from a document or a string', () => {
    expect(holonColor('h1', PALETTE, { color: '#abcdef' })).toBe('#abcdef');
    expect(holonColor('h1', PALETTE, '#ABCDEF')).toBe('#abcdef');
  });

  it('falls back to the palette when the override is invalid', () => {
    expect(holonColor('h1', PALETTE, { color: 'not-a-colour' })).toBe(holonColor('h1', PALETTE));
    expect(holonColor('h1', PALETTE, '')).toBe(holonColor('h1', PALETTE));
  });
});

describe('saveHolonColor', () => {
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

  it('merges the colour over the existing document', async () => {
    const hs = fakeHs({ id: 'h1', name: 'Casa', language: 'it' });
    expect(await saveHolonColor(hs as any, 'h1', '#ABC')).toBe('#aabbcc');
    expect(hs.puts).toEqual([{ id: 'h1', name: 'Casa', language: 'it', color: '#aabbcc' }]);
  });

  it('clears the override with an empty or invalid colour', async () => {
    const hs = fakeHs({ id: 'h1', color: '#aabbcc' });
    expect(await saveHolonColor(hs as any, 'h1', '')).toBe('');
    expect(hs.puts[0].color).toBe('');
  });

  it('still writes when the read fails', async () => {
    const hs = fakeHs(null, { getFails: true });
    await saveHolonColor(hs as any, 'h1', '#123456');
    expect(hs.puts).toEqual([{ id: 'h1', color: '#123456' }]);
  });
});

describe('parseHolonSettings colour', () => {
  it('carries a valid colour and drops an invalid one', () => {
    expect(parseHolonSettings({ id: 'h1', color: '#ABCDEF' }).color).toBe('#abcdef');
    expect(parseHolonSettings({ id: 'h1', color: 'teal' }).color).toBeUndefined();
    expect(parseHolonSettings({ id: 'h1' }).color).toBeUndefined();
  });
});
