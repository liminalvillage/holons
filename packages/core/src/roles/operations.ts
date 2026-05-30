// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/roles — pure role operations (no I/O).
//
// Extracted from packages/telegram-ui/src/Roles.ts. These functions never
// touch Holosphere; persistence.ts wraps them with reads/writes.

import type { Role, RoleCountUser, RoleParticipant } from './types.js';

/** Build a fresh role. `id` mirrors the (unique) title. */
export function createRole(title: string, description = ''): Role {
  return {
    id: title,
    title,
    description,
    participants: [],
    checklistId: null,
    created: new Date().toISOString(),
  };
}

/**
 * Coerce legacy bare-string participants to objects. Mirrors the migration the
 * Telegram bot ran inline (Roles.ts) so every UI sees one shape.
 */
export function normalizeParticipants(
  participants: Array<RoleParticipant | string> | undefined | null
): RoleParticipant[] {
  if (!Array.isArray(participants)) return [];
  return participants.map(p =>
    typeof p === 'string'
      ? { id: null, username: p, first_name: null, last_name: null }
      : p
  );
}

/** Return a copy of the role with its participants normalised. */
export function normalizeRole(role: Role): Role {
  return { ...role, participants: normalizeParticipants(role.participants) };
}

/** True when `user` (matched by id, falling back to username) is in the role. */
export function isParticipant(
  role: Role,
  userId: string | number | null,
  username?: string | null
): boolean {
  return normalizeParticipants(role.participants).some(
    p =>
      (userId != null && p.id === userId) ||
      (!!username && p.username === username)
  );
}

/**
 * Toggle a user's membership. Returns a new role plus whether the user ended
 * up joined. Matching is by id first, then username (covers migrated members).
 */
export function toggleParticipant(
  role: Role,
  user: RoleParticipant
): { role: Role; joined: boolean } {
  const participants = normalizeParticipants(role.participants);
  const index = participants.findIndex(
    p =>
      (user.id != null && p.id === user.id) ||
      (!!user.username && p.username === user.username)
  );
  if (index !== -1) {
    participants.splice(index, 1);
    return { role: { ...role, participants }, joined: false };
  }
  participants.push(user);
  return { role: { ...role, participants }, joined: true };
}

/** Add a user if not already present (idempotent). */
export function addParticipant(role: Role, user: RoleParticipant): Role {
  if (isParticipant(role, user.id, user.username)) return normalizeRole(role);
  return { ...role, participants: [...normalizeParticipants(role.participants), user] };
}

/** Remove a user by id or username. */
export function removeParticipant(
  role: Role,
  userId: string | number | null,
  username?: string | null
): Role {
  const participants = normalizeParticipants(role.participants).filter(
    p =>
      !(
        (userId != null && p.id === userId) ||
        (!!username && p.username === username)
      )
  );
  return { ...role, participants };
}

/** Empty the role's participant list. */
export function clearParticipants(role: Role): Role {
  return { ...role, participants: [] };
}

/**
 * Tally a completed stint of a role onto a user record: `roles[roleId] += 1`.
 * Pure — returns an updated copy. Used when clearing roles so members keep a
 * running count of how many rotations they've served.
 */
export function incrementRoleCount(
  user: RoleCountUser,
  roleId: string
): RoleCountUser {
  const roles = { ...(user.roles ?? {}) };
  roles[roleId] = (roles[roleId] ?? 0) + 1;
  return { ...user, roles };
}
