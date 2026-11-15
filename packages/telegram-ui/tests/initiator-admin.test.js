// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { initiatorAdmin } from '../src/initiatorAdmin.js';

describe('initiatorAdmin — who adds the bot becomes admin', () => {
  const person = { id: 235114395, is_bot: false };

  it('names the chat creator who added the bot to a holon without admin', () => {
    expect(initiatorAdmin({ admin: '' }, person, 'creator')).toBe('235114395');
    expect(initiatorAdmin({}, person, 'administrator')).toBe('235114395');
    expect(initiatorAdmin(null, person, 'creator')).toBe('235114395');
  });

  it('never replaces an existing admin', () => {
    expect(
      initiatorAdmin({ admin: '1971913512' }, person, 'creator')
    ).toBeNull();
  });

  it('ignores plain members and unknown statuses', () => {
    expect(initiatorAdmin({ admin: '' }, person, 'member')).toBeNull();
    expect(initiatorAdmin({ admin: '' }, person, undefined)).toBeNull();
  });

  it('ignores bots and a missing initiator', () => {
    expect(
      initiatorAdmin({ admin: '' }, { id: 1, is_bot: true }, 'administrator')
    ).toBeNull();
    expect(initiatorAdmin({ admin: '' }, undefined, 'creator')).toBeNull();
  });
});
