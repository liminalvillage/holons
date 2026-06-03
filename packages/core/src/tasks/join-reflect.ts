/**
 * Reflect a quest join into the joining member's personal holon.
 *
 * When a member joins a quest that lives in *another* holon, we mirror the
 * quest into that member's personal holon (whose id is the member's id) as a
 * hologram — a bare `{ id, soul }` pointer back to the source. This is what
 * makes a joined task show up under "my holon" and, via each UI's reaction to
 * that write, reach the member personally:
 *
 *   - Web wraps `holosphere.put` for the `quests` lens so every write fires the
 *     bot's `/refresh/quest` update API. A hologram write to `(memberId,
 *     'quests')` therefore makes the bot create/refresh the Telegram message in
 *     chat `memberId` — i.e. a DM. The hologram write *is* the cross-UI signal.
 *   - Web itself renders the new hologram in the member's holon view via its
 *     existing `quests` subscription.
 *
 * Skipped when the quest already lives in the member's personal holon — there
 * is nothing to mirror, and we must not write a hologram that points at itself.
 *
 * Pure orchestration over `publishToFederation`; no UI imports.
 */

import type { HoloSphere } from 'holosphere';
import { publishToFederation } from '../federation/publish.js';
import type { Quest, QuestParticipant } from './types.js';

export interface ReflectJoinContext {
  holosphere: HoloSphere;
  /** Holon where the quest actually lives (its home). */
  homeHolonId: string | number;
  /** The quest that was just joined. Only `id` is required for the hologram. */
  quest: { id: Quest['id']; [k: string]: any };
  /** The member who joined — `id` doubles as their personal holon id. */
  user: QuestParticipant;
}

export type ReflectSkipReason = 'no-user-id' | 'no-quest-id' | 'same-as-home';

export interface ReflectJoinResult {
  /** True when a hologram was written into the member's personal holon. */
  reflected: boolean;
  /** The member's personal holon id, when resolvable. */
  callerHolonId: string | null;
  /** Why a reflection was skipped, when it was. */
  reason?: ReflectSkipReason;
}

/**
 * Mirror a freshly-joined quest into the joining member's personal holon.
 *
 * Idempotent at the data layer: writing the same `{ id, soul }` hologram twice
 * is a no-op, so calling this on every join is safe.
 */
export async function reflectJoin(ctx: ReflectJoinContext): Promise<ReflectJoinResult> {
  const { holosphere, homeHolonId, quest, user } = ctx;

  const callerHolonId = user?.id != null ? String(user.id) : null;
  if (!callerHolonId) return { reflected: false, callerHolonId: null, reason: 'no-user-id' };
  if (!quest?.id) return { reflected: false, callerHolonId, reason: 'no-quest-id' };
  if (callerHolonId === String(homeHolonId)) {
    return { reflected: false, callerHolonId, reason: 'same-as-home' };
  }

  await publishToFederation(
    { holosphere, holonId: String(homeHolonId), lens: 'quests', item: { ...quest, id: String(quest.id) } },
    { kind: 'partner', holonId: callerHolonId }
  );

  return { reflected: true, callerHolonId };
}
