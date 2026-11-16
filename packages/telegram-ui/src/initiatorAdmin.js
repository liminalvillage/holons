// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Who becomes a holon's admin when the bot joins a group.
//
// `settings.admin` is the Telegram user whose derived key the membership sync
// seats as ADMIN in the holon's signed `_members` log (createHoloSphere.js
// `syncMembership`). Left empty, the bot key is the only admin and nobody can
// do admin-only things from a screen — federating, guarded settings, seating
// keys. So the person who brings the bot in names themselves admin, when:
//   - the holon has no admin yet (an existing admin is never replaced),
//   - they are a person (not another bot), and
//   - they are the chat's creator or one of its Telegram administrators
//     (re-adding the bot to someone else's group does not hand it over).

const CHAT_ADMIN_STATUSES = new Set(['creator', 'administrator']);

/**
 * The admin id to write, or null to leave `settings.admin` as it is.
 *
 * @param {{ admin?: unknown } | null | undefined} settings - current holon settings
 * @param {{ id?: number|string, is_bot?: boolean } | null | undefined} initiator - `my_chat_member.from`
 * @param {string | null | undefined} initiatorStatus - their status in the chat (getChatMember)
 * @returns {string | null}
 */
export function initiatorAdmin(settings, initiator, initiatorStatus) {
  if (String(settings?.admin ?? '').trim()) return null;
  if (!initiator || initiator.is_bot) return null;
  if (initiator.id === undefined || initiator.id === null) return null;
  if (!CHAT_ADMIN_STATUSES.has(String(initiatorStatus ?? ''))) return null;
  return String(initiator.id);
}
