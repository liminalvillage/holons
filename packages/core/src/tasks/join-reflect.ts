/**
 * Reflect quest membership changes into the member's personal holon.
 *
 * When a member joins a quest that lives in *another* holon, we mirror the
 * quest into that member's personal holon (whose id is the member's id) as a
 * hologram — a bare `{ id, soul }` pointer back to the source. Leaving removes
 * that pointer again. This is what makes a joined task show up under "my holon"
 * and, via each UI's reaction to that write, reach the member personally:
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
 * Pure orchestration over `publishToFederation` / `holosphere.delete`; no UI
 * imports.
 */

import type { HoloSphere } from 'holosphere';
import { publishToFederation } from '../federation/publish.js';
import type { Quest, QuestParticipant } from './types.js';

export interface ReflectContext {
  holosphere: HoloSphere;
  /** Holon where the quest actually lives (its home). */
  homeHolonId: string | number;
  /** The quest whose membership changed. Only `id` is required for the hologram. */
  quest: { id: Quest['id']; [k: string]: any };
  /** The member who joined/left — `id` doubles as their personal holon id. */
  user: QuestParticipant;
}

/** @deprecated kept for back-compat; use {@link ReflectContext}. */
export type ReflectJoinContext = ReflectContext;

export type ReflectSkipReason = 'no-user-id' | 'no-quest-id' | 'same-as-home';

export interface ReflectResult {
  /** True when the member's personal-holon mirror was changed (added/removed). */
  reflected: boolean;
  /** The member's personal holon id, when resolvable. */
  callerHolonId: string | null;
  /** Why a reflection was skipped, when it was. */
  reason?: ReflectSkipReason;
}

/** @deprecated kept for back-compat; use {@link ReflectResult}. */
export type ReflectJoinResult = ReflectResult;

/**
 * Resolve the member's personal holon and apply the shared skip guards.
 * Returns the holon id when a reflection should proceed, or a ready-made skip
 * result otherwise.
 */
function resolveTarget(
  ctx: ReflectContext
): { ok: true; callerHolonId: string } | { ok: false; result: ReflectResult } {
  const callerHolonId = ctx.user?.id != null ? String(ctx.user.id) : null;
  if (!callerHolonId) {
    return { ok: false, result: { reflected: false, callerHolonId: null, reason: 'no-user-id' } };
  }
  if (!ctx.quest?.id) {
    return { ok: false, result: { reflected: false, callerHolonId, reason: 'no-quest-id' } };
  }
  if (callerHolonId === String(ctx.homeHolonId)) {
    return { ok: false, result: { reflected: false, callerHolonId, reason: 'same-as-home' } };
  }
  return { ok: true, callerHolonId };
}

/**
 * Mirror a freshly-joined quest into the joining member's personal holon.
 *
 * Idempotent at the data layer: writing the same `{ id, soul }` hologram twice
 * is a no-op, so calling this on every join is safe.
 */
export async function reflectJoin(ctx: ReflectContext): Promise<ReflectResult> {
  const target = resolveTarget(ctx);
  if (!target.ok) return target.result;

  await publishToFederation(
    {
      holosphere: ctx.holosphere,
      holonId: String(ctx.homeHolonId),
      lens: 'quests',
      item: { ...ctx.quest, id: String(ctx.quest.id) },
    },
    { kind: 'partner', holonId: target.callerHolonId }
  );

  return { reflected: true, callerHolonId: target.callerHolonId };
}

/**
 * Remove the personal-holon hologram a previous {@link reflectJoin} created,
 * when a member leaves a quest. The deleted entry is a *forward* (a bare
 * `{ id, soul }` pointer), so `holosphere.delete` also unregisters it from the
 * source quest's `_holograms` set — no dangling pointer left behind.
 *
 * Idempotent: deleting an absent hologram is a no-op.
 */
export async function reflectLeave(ctx: ReflectContext): Promise<ReflectResult> {
  const target = resolveTarget(ctx);
  if (!target.ok) return target.result;

  await (ctx.holosphere as any).delete(target.callerHolonId, 'quests', String(ctx.quest.id));

  return { reflected: true, callerHolonId: target.callerHolonId };
}
