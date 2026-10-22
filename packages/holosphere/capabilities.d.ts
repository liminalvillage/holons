// SPDX-License-Identifier: AGPL-3.0-or-later
/** The roles a holon knows, strongest first. */
export const ROLES: readonly ['admin', 'member'];
/** Action → the weakest role whose signature counts for it. */
export const CAPABILITIES: Readonly<{
  content: 'member';
  'settings.guarded': 'admin';
  members: 'admin';
  federation: 'admin';
  policy: 'admin';
  'privacy.lock': 'member';
  'privacy.override': 'admin';
}>;
export type Capability = keyof typeof CAPABILITIES;
/** Settings fields that come from an admin's envelope under an authorized read. */
export const GUARDED_SETTINGS_FIELDS: readonly string[];
/** Global tables whose records belong to the holon named by their id (admin-signed). */
export const HOLON_OWNED_GLOBAL_TABLES: readonly string[];
/** The weakest role an action needs; unknown actions need an admin. */
export function requiredRole(action: string): 'admin' | 'member';
/** Does `role` satisfy `action`? */
export function roleSatisfies(role: 'admin' | 'member' | null | undefined, action: string): boolean;
