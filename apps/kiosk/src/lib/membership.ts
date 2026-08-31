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

// A Telegram user id (number) or a key user's pubkey hex — core stores
// QuestParticipant.id as string | number and compares identities stringified.
export type TgUser = {
  id: number | string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

/**
 * Where a federated/hologram quest actually lives (see `sourceRef` in data.ts).
 * A foreign card's membership must be written to its owner holon — writing the
 * local pointer would fork a stray copy that shadows the original. Own items
 * pass `undefined` and are written in place.
 */
export type SourceRef = { holon: string; key: string };

/** A participant record without undefined fields (Holosphere warns on those). */
/** The participant record a Telegram user is stored as on a quest. */
export function person(u: TgUser): QuestParticipant {
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

/**
 * Toggle the user's appreciation (removes them from participants). Returns
 * whether the write landed.
 */
export async function toggleAppreciate(
  holonId: string,
  questId: string,
  user: TgUser,
  ref?: SourceRef,
): Promise<boolean> {
  const holon = ref?.holon ?? holonId;
  const key = ref?.key ?? questId;
  const q = await freshQuest(holon, key);
  if (!q) return false;
  const writer = await getWriter(holon);
  return !!(await writer.put("quests", toggleAppreciation(q, person(user))));
}

/** Is the user a participant of the (already-toggled) quest? */
function isParticipant(quest: Quest, userId: number | string): boolean {
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

/**
 * Toggle the user's participation (removes them from appreciation). Returns
 * whether the write landed.
 */
export async function toggleJoin(
  holonId: string,
  questId: string,
  user: TgUser,
  ref?: SourceRef,
): Promise<boolean> {
  const holon = ref?.holon ?? holonId;
  const key = ref?.key ?? questId;
  const q = await freshQuest(holon, key);
  if (!q) return false;
  const updated = toggleParticipant(q, person(user));
  const writer = await getWriter(holon);
  const ok = await writer.put("quests", updated);
  if (!ok) return false;
  // Mirror into the joiner's personal holon + (re)send the linked DM.
  // Best-effort: the membership write already succeeded.
  await reflectMembership(
    holon,
    updated,
    user,
    isParticipant(updated, user.id),
  );
  return true;
}

/**
 * One-way membership for the swipe deck: a swipe must never *undo* anything, so
 * these check the freshest copy and become no-ops (`"already"`) instead of
 * toggling off. `"failed"` means the read or write didn't land.
 */
export async function joinOnly(
  holonId: string,
  questId: string,
  user: TgUser,
  ref?: SourceRef,
): Promise<"joined" | "already" | "failed"> {
  const holon = ref?.holon ?? holonId;
  const key = ref?.key ?? questId;
  const q = await freshQuest(holon, key);
  if (!q) return "failed";
  if (isParticipant(q, user.id)) return "already";
  try {
    const updated = toggleParticipant(q, person(user));
    const writer = await getWriter(holon);
    const ok = await writer.put("quests", updated);
    if (!ok) return "failed";
    await reflectMembership(holon, updated, user, true);
    return "joined";
  } catch {
    return "failed";
  }
}

/** Is the user among the quest's appreciators? */
function isAppreciating(quest: Quest, userId: number | string): boolean {
  const list = (quest.appreciation ?? []) as QuestParticipant[];
  return list.some((p) => String(p?.id) === String(userId));
}

/** One-way appreciation for the swipe deck — see {@link joinOnly}. */
export async function appreciateOnly(
  holonId: string,
  questId: string,
  user: TgUser,
  ref?: SourceRef,
): Promise<"liked" | "already" | "failed"> {
  const holon = ref?.holon ?? holonId;
  const key = ref?.key ?? questId;
  const q = await freshQuest(holon, key);
  if (!q) return "failed";
  if (isAppreciating(q, user.id)) return "already";
  try {
    const writer = await getWriter(holon);
    const ok = await writer.put("quests", toggleAppreciation(q, person(user)));
    return ok ? "liked" : "failed";
  } catch {
    return "failed";
  }
}
