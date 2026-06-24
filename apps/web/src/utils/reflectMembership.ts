// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Mirror a quest membership change into the member's personal holon and keep
// their linked Telegram DM in sync. Thin web wrapper over core
// reflectJoin/reflectLeave (@holons/core/tasks).
//
// DM mechanics on the web:
//   • Join  → reflectJoin writes a {id,soul} hologram into (memberId,'quests',
//     questId) via the SAME holosphere instance whose `put` is wrapped in
//     +layout.svelte to POST /refresh/quest on every `quests` write — so the DM
//     fires automatically. We must NOT POST again here or the member gets two.
//   • Leave → reflectLeave is a `delete`, which the put-wrapper does NOT
//     intercept, so we POST /refresh/quest explicitly to refresh/remove the DM.
//
// Best-effort: the participant write has already happened; a failure here must
// never surface as a join failure.

import { reflectJoin, reflectLeave } from "@holons/core/tasks";
import type { HoloSphere } from "holosphere";

const BOT_API_URL = (import.meta.env.VITE_BOT_API_URL || "").replace(/\/$/, "");

export async function reflectMembership(opts: {
  holosphere: HoloSphere;
  holonId: string;
  questId: string;
  userId: string | number;
  joined: boolean;
}): Promise<void> {
  const { holosphere, holonId, questId, userId, joined } = opts;
  try {
    const ctx = {
      holosphere,
      homeHolonId: holonId,
      quest: { id: String(questId) },
      user: { id: userId } as any,
    };
    if (joined) {
      await reflectJoin(ctx); // DM fires via the +layout put-wrapper
    } else {
      await reflectLeave(ctx);
      // delete bypasses the put-wrapper → refresh the DM ourselves.
      if (BOT_API_URL) {
        fetch(`${BOT_API_URL}/refresh/quest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId: String(userId),
            questId: String(questId),
          }),
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.warn("[web] reflectMembership failed", err);
  }
}
