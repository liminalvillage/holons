// SPDX-License-Identifier: AGPL-3.0-or-later
/** The roles a holon knows, strongest first. The stored value `admin` is the ambassador role (kept on the wire for existing signed logs). */
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
  'library.manage': 'admin';
}>;
export type Capability = keyof typeof CAPABILITIES;
/** Settings fields that come from an ambassador's envelope under an authorized read. */
export const GUARDED_SETTINGS_FIELDS: readonly string[];
/** Global tables whose records belong to the holon named by their id (ambassador-signed). */
export const HOLON_OWNED_GLOBAL_TABLES: readonly string[];
/** The weakest role an action needs; unknown actions need an ambassador. */
export function requiredRole(action: string): 'admin' | 'member';
/** Does `role` satisfy `action`? */
export function roleSatisfies(role: 'admin' | 'member' | null | undefined, action: string): boolean;
