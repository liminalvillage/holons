// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Who is a holon's ambassador, as `settings.admin` names them.
//
// `settings.admin` (the stored field keeps its name) is the Telegram user id
// whose derived key the membership sync seats as the ambassador in the holon's
// signed `_members` log (createHoloSphere.js `syncMembership`). Left empty, the
// bot key is the only ambassador and nobody can do ambassador-only things from
// a screen — federating, guarded settings, seating keys. A value that is not a
// Telegram user id (an @username) seats a key nobody holds, which is the same
// as having no ambassador.
//
// Whoever brings the bot into the group introduces the holon, so they become
// its ambassador when the holon has none yet. Their chat role does not matter,
// and an existing ambassador is never replaced. (A keyed holon has the same
// rule by construction: its creator's key founds the log as genesis ambassador.)

/**
 * The ambassador id to write when the bot is added, or null to leave
 * `settings.admin` as it is.
 *
 * @param {{ admin?: unknown } | null | undefined} settings - current holon settings
 * @param {{ id?: number|string, is_bot?: boolean } | null | undefined} initiator - `my_chat_member.from`
 * @returns {string | null}
 */
export function initiatorAmbassador(settings, initiator) {
  if (hasAmbassador(settings)) return null;
  if (!initiator || initiator.is_bot) return null;
  if (initiator.id === undefined || initiator.id === null) return null;
  return String(initiator.id);
}

/** Whether `settings.admin` names a Telegram user (an @username does not count). */
export function hasAmbassador(settings) {
  return /^\d{1,20}$/.test(String(settings?.admin ?? '').trim());
}

/**
 * The Telegram user id an ambassador choice names, or null when nobody known.
 * Accepts a numeric id, `@username` or `username` (matched case-insensitively
 * against the holon's `users` lens), or a text mention's user.
 *
 * @param {string | null | undefined} input - what was typed
 * @param {Array<{ id?: number|string, username?: string }> | null | undefined} users - the holon's `users` lens
 * @param {{ id?: number|string } | null | undefined} [mentioned] - user of a `text_mention` entity, if any
 * @returns {string | null}
 */
export function resolveAmbassadorId(input, users, mentioned) {
  if (mentioned && mentioned.id !== undefined && mentioned.id !== null)
    return String(mentioned.id);
  const text = String(input ?? '').trim();
  if (!text) return null;
  if (/^\d{1,20}$/.test(text)) return text;
  const name = text.replace(/^@/, '').toLowerCase();
  if (!name) return null;
  const user = (users ?? []).find(
    u => u && u.id != null && String(u.username ?? '').toLowerCase() === name
  );
  return user ? String(user.id) : null;
}
