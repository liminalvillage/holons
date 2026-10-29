// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Who may do what in a holon — ONE table.
//
// Nothing is refused at write time: relays take every signed event. What a
// write is worth is decided on READ, by everyone, with the same rule: a
// holon's admins and members come from its signed `_members` log (or its
// anchored records), and this table says which role an action needs.
//
//   member  content and the ordinary settings fields; making a scope
//           private (the locker owns its vault)
//   admin   the trust decisions: who is seated, the money and trust fields
//           of settings, the rules of a log, the federation record (which
//           partners, which lenses flow), and overriding a member's vault
//
// A holon nobody speaks for (no log, no anchored records, an H3 cell) is
// open: every claim shows and nothing here applies. The signer reads this
// table for settings and the federation table, the privacy layer for the
// vault, core re-exports it for every surface to grey out what would not
// count.

/** The roles a holon knows, strongest first. */
export const ROLES = Object.freeze(['admin', 'member']);

/** Action → the weakest role whose signature counts for it. */
export const CAPABILITIES = Object.freeze({
  /** Tasks, events, library, stock… and every settings field not guarded. */
  content: 'member',
  /** The settings fields in GUARDED_SETTINGS_FIELDS. */
  'settings.guarded': 'admin',
  /** Seating and unseating keys in the `_members` log. */
  members: 'admin',
  /** The federation record: partners, and which lenses flow each way. */
  federation: 'admin',
  /** A log's rule (`_policy`). */
  policy: 'admin',
  /** Making a lens or a card private. The locker owns the vault. */
  'privacy.lock': 'member',
  /** Unlocking or taking over a scope another key locked. */
  'privacy.override': 'admin',
});

/**
 * Settings fields that decide money and trust: who the holon's key and admin
 * are, which keys it trusts, who vouches for identities, how value is
 * scored and the pot split, and where it is paid. Under an authorized read
 * these come from the newest envelope an ADMIN (as of its time) signed —
 * never from a plain member's, whose settings write still counts for every
 * other field. Without this a member could seat themselves as admin, weigh
 * the equation or the split in their favour, or point the payout at their
 * own wallet, since the lens is last-writer-wins. `onboarding` is the path
 * a newcomer walks before their key is linked: a member who could rewrite it
 * could wave anyone in.
 */
export const GUARDED_SETTINGS_FIELDS = Object.freeze([
  'holonPubkey', 'admin', 'nostrTrustedPubkeys', 'identityProviders',
  'valueEquation', 'equation',
  'allocation', 'pot', 'payout', 'bundle', 'treasury',
  'onboarding',
]);

/**
 * Global tables whose records belong to the holon named by their id: such a
 * record counts only from an admin of that holon.
 */
export const HOLON_OWNED_GLOBAL_TABLES = Object.freeze(['federation']);

/** The weakest role an action needs; unknown actions need an admin. */
export function requiredRole(action) {
  return CAPABILITIES[action] || 'admin';
}

/** Does `role` (admin | member | null) satisfy `action`? */
export function roleSatisfies(role, action) {
  const need = requiredRole(action);
  if (role === 'admin') return true;
  return role === 'member' && need === 'member';
}

export default { ROLES, CAPABILITIES, GUARDED_SETTINGS_FIELDS, HOLON_OWNED_GLOBAL_TABLES, requiredRole, roleSatisfies };
