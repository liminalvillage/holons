// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Who may do what in a holon — the ONE table, as every surface reads it.
 *
 * The table itself lives in `holosphere/capabilities.js`, because the data
 * layer enforces it (the signer on settings and the federation table, the
 * privacy layer on the vault). Core re-exports it and adds the one question
 * a UI, the bot or MCP asks before a write: `may(standing, action)` — would
 * this key's signature count for that?
 *
 *   member  content, ordinary settings fields, making a scope private
 *   admin   seating keys, the guarded settings fields (money, trust, the
 *           value equation), the rules of a log, the federation record,
 *           overriding a member's vault
 *
 * Nothing is refused at write time. A write whose signer lacks the role is
 * recorded on the relays and ignored by every reader — so surfaces grey the
 * control out and say why, instead of letting a person save into silence.
 */

import {
  CAPABILITIES,
  GUARDED_SETTINGS_FIELDS,
  HOLON_OWNED_GLOBAL_TABLES,
  ROLES,
  requiredRole,
  roleSatisfies,
  type Capability,
} from 'holosphere/capabilities.js';
import type { Role } from '../protocol/types.js';
import type { WriteStanding } from './authority.js';

export { CAPABILITIES, GUARDED_SETTINGS_FIELDS, HOLON_OWNED_GLOBAL_TABLES, ROLES, requiredRole, type Capability };

/**
 * Would a key with this standing (or bare role) count for `action`?
 * An open holon (nobody defined) allows everything; a held key nothing.
 */
export function may(standing: WriteStanding | Role | null | undefined, action: Capability): boolean {
  if (standing && typeof standing === 'object') {
    if (standing.status === 'open') return true;
    if (standing.status === 'held') return false;
    return roleSatisfies(standing.role, action);
  }
  return roleSatisfies(standing ?? null, action);
}

/**
 * One sentence a surface shows beside a greyed-out control: why this key's
 * write would not count here. Null when it would.
 */
export function whyNot(standing: WriteStanding | null | undefined, action: Capability): string | null {
  if (!standing) return 'Sign in with a key first.';
  if (may(standing, action)) return null;
  if (standing.status === 'held') return 'Your key is not linked to this holon yet, so your changes would not count.';
  return requiredRole(action) === 'admin'
    ? 'Only an admin of this holon can change this; your change would be recorded but not counted.'
    : 'Only a member of this holon can change this.';
}
