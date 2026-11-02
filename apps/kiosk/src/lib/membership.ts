// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Toggle a user's participation / appreciation on a quest, straight from a card.
// Reads the quest fresh from Holosphere first so the participate-XOR-appreciate
// invariant (owned by @holons/core/tasks) is applied to current data.

import {
  mayAskQuestRefresh,
  questChats,
  toggleAppreciation,
  toggleParticipant,
  type Quest,
  type QuestChatsInput,
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
  const updated = toggleAppreciation(q, person(user));
  const writer = await getWriter(holon);
  const ok = !!(await writer.put("quests", updated));
  if (ok)
    void refreshQuestMessages({
      holon,
      quest: updated,
      before: q,
      touched: [user.id],
      questId: key,
      user,
    });
  return ok;
}

/** Is the user a participant of the (already-toggled) quest? */
function isParticipant(quest: Quest, userId: number | string): boolean {
  const list = (quest.participants ?? []) as QuestParticipant[];
  return list.some((p) => String(p?.id) === String(userId));
}

/**
 * After a quest write, ask the bot to re-render the quest's Telegram messages.
 * Which chats those are — the holon's own chat, the DM of whoever's place on
 * the roster changed, every copy the bot has sent — is core's rule
 * (`questChats`, @holons/core/tasks); the bot renders, the kiosk only asks,
 * one chat per POST through the same-origin `/api/quest/refresh` proxy. The
 * proxy lets a session name its own chat or a group (`mayAskQuestRefresh`), so
 * the ask is filtered the same way here. Best-effort: the write has landed.
 */
export async function refreshQuestMessages(
  input: QuestChatsInput & { questId: string | number; user: TgUser },
): Promise<void> {
  try {
    const chats = questChats(input)
      .map((c) => c.chat)
      .filter((chat) => mayAskQuestRefresh(chat, input.user.id));
    await Promise.all(
      chats.map((chatId) =>
        fetch("/api/quest/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, questId: String(input.questId) }),
        }).catch(() => {}),
      ),
    );
  } catch {
    /* re-rendering the messages is best-effort */
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
  void refreshQuestMessages({
    holon,
    quest: updated,
    before: q,
    touched: [user.id],
    questId: key,
    user,
  });
  return true;
}

/**
 * Put someone else on a card's roster — anyone in the holon, not just the
 * signed-in user. Core's write mirrors the card into that person's own holon.
 * Returns the card as written, `"already"` when they take part already, or
 * `"failed"` when the read or the write didn't land.
 */
export async function addMember(
  holonId: string,
  questId: string,
  member: TgUser,
  ref?: SourceRef,
  /** Who is adding them — the session that may ask the bot to re-render. */
  by: TgUser = member,
): Promise<Quest | "already" | "failed"> {
  const holon = ref?.holon ?? holonId;
  const key = ref?.key ?? questId;
  const q = await freshQuest(holon, key);
  if (!q) return "failed";
  if (isParticipant(q, member.id)) return "already";
  try {
    // Not on the roster (checked above), so the toggle adds — and, by core's
    // participate-XOR-appreciate rule, takes them off the appreciation list.
    const updated = toggleParticipant(q, person(member));
    const writer = await getWriter(holon);
    if (!(await writer.put("quests", updated))) return "failed";
    void refreshQuestMessages({
      holon,
      quest: updated,
      before: q,
      questId: key,
      user: by,
    });
    return updated;
  } catch {
    return "failed";
  }
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
    void refreshQuestMessages({
      holon,
      quest: updated,
      before: q,
      touched: [user.id],
      questId: key,
      user,
    });
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
    const updated = toggleAppreciation(q, person(user));
    const writer = await getWriter(holon);
    const ok = await writer.put("quests", updated);
    if (ok)
      void refreshQuestMessages({
        holon,
        quest: updated,
        before: q,
        touched: [user.id],
        questId: key,
        user,
      });
    return ok ? "liked" : "failed";
  } catch {
    return "failed";
  }
}
