// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Toggle a user's participation / appreciation on a quest, straight from a card.
// Reads the quest fresh from Holosphere first so the participate-XOR-appreciate
// invariant (owned by @holons/core/tasks) is applied to current data.

import {
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

/** Toggle the user's participation (removes them from appreciation). */
export async function toggleJoin(
  holonId: string,
  questId: string,
  user: TgUser,
): Promise<void> {
  const q = await freshQuest(holonId, questId);
  if (!q) return;
  const writer = await getWriter(holonId);
  await writer.put("quests", toggleParticipant(q, person(user)));
}
