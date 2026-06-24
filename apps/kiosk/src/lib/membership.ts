// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Toggle a user's participation / appreciation on a quest, straight from a card.
// Reads the quest fresh from Holosphere first so the participate-XOR-appreciate
// invariant (owned by @holons/core/tasks) is applied to current data.

import {
  reflectJoin,
  reflectLeave,
  toggleAppreciation,
  toggleParticipant,
  type Quest,
  type QuestParticipant,
} from "@holons/core/tasks";
import { getHolosphere, getWriter } from "./holosphere";

export type TgUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

/** A participant record without undefined fields (Holosphere warns on those). */
function person(u: TgUser): QuestParticipant {
  const p: QuestParticipant = { id: u.id };
  if (u.username) p.username = u.username;
  if (u.first_name) p.first_name = u.first_name;
  if (u.last_name) p.last_name = u.last_name;
  return p;
}

async function freshQuest(
  holonId: string,
  questId: string,
): Promise<Quest | null> {
  try {
    const hs = await getHolosphere();
    return ((await hs.get(holonId, "quests", questId)) as Quest) ?? null;
  } catch {
    return null;
  }
}

/** Toggle the user's appreciation (removes them from participants). */
export async function toggleAppreciate(
  holonId: string,
  questId: string,
  user: TgUser,
): Promise<void> {
  const q = await freshQuest(holonId, questId);
  if (!q) return;
  const writer = await getWriter(holonId);
  await writer.put("quests", toggleAppreciation(q, person(user)));
}

/** Is the user a participant of the (already-toggled) quest? */
function isParticipant(quest: Quest, userId: number): boolean {
  const list = (quest.participants ?? []) as QuestParticipant[];
  return list.some((p) => String(p?.id) === String(userId));
}

/**
 * Mirror a membership change into the joiner's personal holon and refresh their
 * Telegram DM. `joined` reflects the post-toggle state. Best-effort: a failure
 * here must never undo the participant write the caller already made.
 *
 *  - join  → core `reflectJoin` writes a {id,soul} hologram into
 *            (userId,'quests',questId), then the bot DM is (re)created.
 *  - leave → core `reflectLeave` deletes that hologram, then the DM is refreshed.
 *
 * The DM is triggered via the same-origin `/api/quest/refresh` proxy (the bot's
 * own endpoint is CORS-locked to the dashboard origin).
 */
export async function reflectMembership(
  holonId: string,
  quest: Quest,
  user: TgUser,
  joined: boolean,
): Promise<void> {
  try {
    const holosphere = await getHolosphere();
    const ctx = {
      holosphere,
      homeHolonId: holonId,
      quest: { id: String(quest.id) },
      user: person(user),
    };
    if (joined) await reflectJoin(ctx);
    else await reflectLeave(ctx);
  } catch (err) {
    console.warn("[kiosk] reflectMembership failed", err);
  }
  try {
    await fetch("/api/quest/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: String(user.id),
        questId: String(quest.id),
      }),
    });
  } catch {
    /* DM refresh is best-effort */
  }
}

/** Toggle the user's participation (removes them from appreciation). */
export async function toggleJoin(
  holonId: string,
  questId: string,
  user: TgUser,
): Promise<void> {
  const q = await freshQuest(holonId, questId);
  if (!q) return;
  const updated = toggleParticipant(q, person(user));
  const writer = await getWriter(holonId);
  await writer.put("quests", updated);
  await reflectMembership(
    holonId,
    updated,
    user,
    isParticipant(updated, user.id),
  );
}
