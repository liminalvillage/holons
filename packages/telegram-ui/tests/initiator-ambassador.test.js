// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import {
  initiatorAmbassador,
  hasAmbassador,
  resolveAmbassadorId,
} from '../src/initiatorAmbassador.js';

describe('initiatorAmbassador — whoever adds the bot becomes ambassador', () => {
  const person = { id: 235114395, is_bot: false };

  it('names whoever added the bot to a holon without ambassador', () => {
    expect(initiatorAmbassador({ admin: '' }, person)).toBe('235114395');
    expect(initiatorAmbassador({}, person)).toBe('235114395');
    expect(initiatorAmbassador(null, person)).toBe('235114395');
  });

  it('never replaces an existing ambassador', () => {
    expect(initiatorAmbassador({ admin: '1971913512' }, person)).toBeNull();
  });

  it('replaces an @username ambassador, which seats nobody', () => {
    expect(initiatorAmbassador({ admin: '@someone' }, person)).toBe(
      '235114395'
    );
  });

  it('ignores bots and a missing initiator', () => {
    expect(
      initiatorAmbassador({ admin: '' }, { id: 1, is_bot: true })
    ).toBeNull();
    expect(initiatorAmbassador({ admin: '' }, undefined)).toBeNull();
  });
});

describe('hasAmbassador', () => {
  it('counts only a Telegram user id', () => {
    expect(hasAmbassador({ admin: '235114395' })).toBe(true);
    expect(hasAmbassador({ admin: '@roberto' })).toBe(false);
    expect(hasAmbassador({ admin: '' })).toBe(false);
    expect(hasAmbassador(null)).toBe(false);
  });
});

describe('resolveAmbassadorId — /setambassador stores an id, not a username', () => {
  const users = [
    { id: 235114395, username: 'RobertoValenti' },
    { id: '42', first_name: 'No Username' },
  ];

  it('resolves @username and bare username case-insensitively', () => {
    expect(resolveAmbassadorId('@robertovalenti', users)).toBe('235114395');
    expect(resolveAmbassadorId('RobertoValenti', users)).toBe('235114395');
  });

  it('passes a numeric id through', () => {
    expect(resolveAmbassadorId(' 42 ', users)).toBe('42');
  });

  it('prefers a text mention', () => {
    expect(resolveAmbassadorId('Someone', users, { id: 7 })).toBe('7');
  });

  it('returns null for unknown or empty input', () => {
    expect(resolveAmbassadorId('@stranger', users)).toBeNull();
    expect(resolveAmbassadorId('', users)).toBeNull();
    expect(resolveAmbassadorId('@', users)).toBeNull();
    expect(resolveAmbassadorId('@x', null)).toBeNull();
  });
});
