// Members are named by any key they hold; strangers and partners through the
// shared resolver; nothing is ever shown as a bare id.
import { describe, expect, it } from 'vitest';
import { deriveTelegramNostrKey } from '@holons/core/auth';
import { shortId } from '@holons/core/identity';
import {
  memberDisplayName,
  memberNames,
  partyNames,
} from '../src/protocolContext.js';

const SECRET = 'test-secret';
const linked = 'c'.repeat(64);
const users = [
  {
    id: 42,
    first_name: 'Ada',
    last_name: 'Lovelace',
    username: 'ada',
    linkedKeys: [linked],
  },
  { id: 7, username: '7' },
  { id: 9, username: 'grace' },
];
const fake = {
  getAll: async (holon, lens) =>
    lens === 'users' && holon === '-1' ? users : [],
  get: async (holon, lens, key) =>
    lens === 'settings' && holon === '-2002'
      ? { id: '-2002', name: 'Casa Selva' }
      : null,
  getAllGlobal: async () => [],
  queryNostr: async () => [],
};

describe('memberNames', () => {
  it('names a member by id, by derived key and by linked key, in bot style', async () => {
    const names = await memberNames(fake, '-1', { secret: SECRET });
    const derived = deriveTelegramNostrKey(42, SECRET).publicKey;
    expect(names.get('42')).toBe('Ada L. (@ada)');
    expect(names.get(derived)).toBe('Ada L. (@ada)');
    expect(names.get(linked)).toBe('Ada L. (@ada)');
    expect(names.get('9')).toBe('grace');
    // A digits-only handle is not a name: the short form, never "7 (@7)".
    expect(names.get('7')).toBe('#7');
  });
});

describe('partyNames / memberDisplayName', () => {
  it('names partners through settings and strangers in the short form', async () => {
    const stranger = 'd'.repeat(64);
    const names = await partyNames(fake, '-1', ['42', '-2002', stranger]);
    expect(names.get('42')).toBe('Ada L. (@ada)');
    expect(names.get('-2002')).toBe('Casa Selva');
    expect(names.get(stranger)).toBe(shortId(stranger));
    expect(await memberDisplayName(fake, '-1', 9)).toBe('grace');
    expect(await memberDisplayName(fake, '-1', 'e'.repeat(64))).toBe(
      shortId('e'.repeat(64))
    );
  });
});
