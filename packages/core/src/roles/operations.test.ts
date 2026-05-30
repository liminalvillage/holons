// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import {
  addParticipant,
  clearParticipants,
  createRole,
  incrementRoleCount,
  isParticipant,
  normalizeParticipants,
  removeParticipant,
  toggleParticipant,
} from './operations.js';

describe('roles/operations', () => {
  it('createRole mirrors id to title and starts empty', () => {
    const role = createRole('Space Angel', 'Welcomes newcomers');
    expect(role.id).toBe('Space Angel');
    expect(role.title).toBe('Space Angel');
    expect(role.description).toBe('Welcomes newcomers');
    expect(role.participants).toEqual([]);
    expect(role.checklistId).toBeNull();
  });

  it('normalizeParticipants coerces legacy strings to objects', () => {
    const out = normalizeParticipants(['alice', { id: 2, username: 'bob' }]);
    expect(out[0]).toEqual({
      id: null,
      username: 'alice',
      first_name: null,
      last_name: null,
    });
    expect(out[1]).toEqual({ id: 2, username: 'bob' });
    expect(normalizeParticipants(undefined)).toEqual([]);
  });

  it('toggleParticipant joins then leaves (by id)', () => {
    const role = createRole('Cook');
    const user = { id: 7, username: 'sam' };
    const joined = toggleParticipant(role, user);
    expect(joined.joined).toBe(true);
    expect(joined.role.participants).toHaveLength(1);
    const left = toggleParticipant(joined.role, user);
    expect(left.joined).toBe(false);
    expect(left.role.participants).toHaveLength(0);
  });

  it('toggleParticipant matches migrated members by username', () => {
    const role = { ...createRole('Cook'), participants: ['sam'] as unknown as [] };
    const left = toggleParticipant(role, { id: 7, username: 'sam' });
    expect(left.joined).toBe(false);
    expect(left.role.participants).toHaveLength(0);
  });

  it('add/remove/isParticipant are idempotent and id/username aware', () => {
    let role = createRole('Cook');
    role = addParticipant(role, { id: 1, username: 'a' });
    role = addParticipant(role, { id: 1, username: 'a' }); // no dup
    expect(role.participants).toHaveLength(1);
    expect(isParticipant(role, 1)).toBe(true);
    expect(isParticipant(role, null, 'a')).toBe(true);
    role = removeParticipant(role, 1);
    expect(role.participants).toHaveLength(0);
  });

  it('clearParticipants empties the list', () => {
    const role = addParticipant(createRole('Cook'), { id: 1 });
    expect(clearParticipants(role).participants).toEqual([]);
  });

  it('incrementRoleCount tallies per-role completions', () => {
    const u1 = incrementRoleCount({ id: 1 }, 'Cook');
    expect(u1.roles).toEqual({ Cook: 1 });
    const u2 = incrementRoleCount(u1, 'Cook');
    expect(u2.roles).toEqual({ Cook: 2 });
  });
});
