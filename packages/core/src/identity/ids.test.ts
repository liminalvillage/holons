import { describe, expect, it } from 'vitest';
import * as nip19 from 'nostr-tools/nip19';
import { cleanName, idKind, isKeyId, isPlaceholderName, normalizeId, shortId } from './ids.js';

const HEX = 'ab'.repeat(32);
const NPUB = nip19.npubEncode(HEX);

describe('normalizeId', () => {
  it('turns hex, npub and nostr: forms into lowercase hex; leaves other ids as text', () => {
    expect(normalizeId(HEX.toUpperCase())).toBe(HEX);
    expect(normalizeId(NPUB)).toBe(HEX);
    expect(normalizeId(`nostr:${NPUB}`)).toBe(HEX);
    expect(normalizeId(' 235114395 ')).toBe('235114395');
    expect(normalizeId(-1003864542239)).toBe('-1003864542239');
    expect(normalizeId('holon_abcdefghijkl')).toBe('holon_abcdefghijkl');
    expect(normalizeId(null)).toBe('');
    expect(normalizeId('npub1notvalid')).toBe('npub1notvalid');
  });
});

describe('idKind', () => {
  it('tells a Telegram person, a holon and a key apart', () => {
    expect(idKind(235114395)).toBe('person');
    expect(idKind('-1003864542239')).toBe('holon');
    expect(idKind('holon_abcdefghijkl')).toBe('holon');
    expect(idKind('hub_abcdefghijkl')).toBe('holon');
    expect(idKind(HEX)).toBe('key');
    expect(idKind(NPUB)).toBe('key');
    expect(isKeyId(NPUB)).toBe(true);
    expect(isKeyId('42')).toBe(false);
  });
});

describe('shortId', () => {
  it('is the one short form: a shortened npub, #id for a Telegram id, the id otherwise', () => {
    expect(shortId(HEX)).toBe(`${NPUB.slice(0, 13)}…${NPUB.slice(-6)}`);
    expect(shortId(NPUB)).toBe(shortId(HEX));
    expect(shortId(42)).toBe('#42');
    expect(shortId('-1003864542239')).toBe('-1003864542239');
    expect(shortId('holon_abc')).toBe('holon_abc');
    expect(shortId('')).toBe('');
  });
});

describe('isPlaceholderName', () => {
  it('recognises every stand-in for the id and nothing else', () => {
    expect(isPlaceholderName(shortId(HEX), HEX)).toBe(true);
    expect(isPlaceholderName(NPUB, HEX)).toBe(true);
    expect(isPlaceholderName(`${NPUB.slice(0, 13)}...${NPUB.slice(-8)}`, HEX)).toBe(true);
    expect(isPlaceholderName(HEX.slice(0, 8), HEX)).toBe(true);
    expect(isPlaceholderName(`${HEX.slice(0, 8)}…`, HEX)).toBe(true);
    expect(isPlaceholderName('#42', 42)).toBe(true);
    expect(isPlaceholderName('42', 42)).toBe(true);
    expect(isPlaceholderName('', HEX)).toBe(true);
    expect(isPlaceholderName('Ada Lovelace', HEX)).toBe(false);
    expect(isPlaceholderName('npubfan', HEX)).toBe(false);
    expect(isPlaceholderName('Ada', 42)).toBe(false);
  });
});

describe('cleanName', () => {
  it('strips control characters, folds whitespace and caps the length', () => {
    expect(cleanName('  Ada\u0000 ​ Lovelace\n')).toBe('Ada Lovelace');
    expect(cleanName('x'.repeat(100))).toHaveLength(64);
    expect(cleanName(42)).toBe('');
  });
});
