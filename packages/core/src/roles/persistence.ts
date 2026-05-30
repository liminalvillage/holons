// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/roles — Holosphere persistence helpers.
//
// Thin wrappers over the `roles` lens that apply the pure operations. Extracted
// from packages/telegram-ui/src/Roles.ts.

import { incrementRoleCount, normalizeRole } from './operations.js';
import type { Role, RoleCountUser, RolesDB } from './types.js';

export const ROLES_LENS = 'roles';
const USERS_LENS = 'users';
const CHECKLISTS_LENS = 'checklists';

/** List all roles for a holon, participants normalised. */
export async function listRoles(
  db: RolesDB,
  holonId: string | number
): Promise<Role[]> {
  const list = ((await db.getAll(String(holonId), ROLES_LENS)) ?? []) as Role[];
  return list.filter(Boolean).map(normalizeRole);
}

/** Fetch one role by id, or null. */
export async function getRole(
  db: RolesDB,
  holonId: string | number,
  roleId: string
): Promise<Role | null> {
  const role = (await db.get(String(holonId), ROLES_LENS, roleId)) as Role | null;
  return role ? normalizeRole(role) : null;
}

/** Fetch one role by (unique) title, or null. */
export async function getRoleByTitle(
  db: RolesDB,
  holonId: string | number,
  title: string
): Promise<Role | null> {
  const roles = await listRoles(db, holonId);
  return roles.find(r => r.title === title) ?? null;
}

/** Persist a role. */
export async function saveRole(
  db: RolesDB,
  holonId: string | number,
  role: Role
): Promise<void> {
  await db.put(String(holonId), ROLES_LENS, role);
}

/**
 * Delete a role and its linked checklist (best-effort). Mirrors the cascade the
 * Telegram bot performed inline so a removed role never orphans its checklist.
 */
export async function deleteRoleWithChecklist(
  db: RolesDB,
  holonId: string | number,
  role: Role
): Promise<void> {
  const holon = String(holonId);
  if (role.checklistId) {
    await db.delete(holon, CHECKLISTS_LENS, role.checklistId).catch(() => {});
  }
  await db.delete(holon, ROLES_LENS, role.id);
}

/**
 * Clear participants from every role, first tallying each departing member's
 * stint onto their user record (`roles[roleId] += 1`). Returns the cleared
 * roles. This is the persistence-side of the Telegram "clear all roles" button.
 */
export async function clearAllRoles(
  db: RolesDB,
  holonId: string | number
): Promise<Role[]> {
  const holon = String(holonId);
  const roles = await listRoles(db, holon);
  for (const role of roles) {
    for (const participant of role.participants) {
      if (participant.id == null) continue;
      const user = (await db.get(
        holon,
        USERS_LENS,
        participant.id
      )) as RoleCountUser | null;
      if (!user) continue;
      await db.put(holon, USERS_LENS, incrementRoleCount(user, role.id));
    }
    role.participants = [];
    await db.put(holon, ROLES_LENS, role);
  }
  return roles;
}
