// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Copy/paste of cards between holons, devices and any text surface. The
// payload format and the sanitisation rules (what travels, what doesn't) live
// in @holons/core/clipboard; this module only moves text through the system
// clipboard and lands pasted cards in the displayed holon.

import { get } from "svelte/store";
import {
  cardFromQuest,
  cardFromLibraryItem,
  encodeCardText,
  parseCardText,
  questFromCard,
  libraryAddFromCard,
} from "@holons/core/clipboard";
import { addItem } from "@holons/core/library";
import type { Quest } from "@holons/core/tasks";
import type { LibraryItem } from "@holons/core/library";
import { holonId, showNotice, type Selection } from "./stores";
import { telegramUser, loginOpen } from "./auth";
import { getWriter, getLibraryDb } from "./holosphere";

export { parseCardText };

/** Fresh quest id, matching the add-task convention (time + random suffix). */
function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Write text to the system clipboard. The async Clipboard API needs a secure
 * context; fall back to a transient textarea + execCommand for plain-http
 * wall displays.
 */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to execCommand */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Copy the open detail card (quest or library thing) to the clipboard. */
export async function copySelection(sel: Selection): Promise<void> {
  if (!sel) return;
  const payload =
    sel.kind === "thing"
      ? cardFromLibraryItem(sel.item as LibraryItem)
      : cardFromQuest(sel.quest as Quest);
  const ok = await writeClipboard(encodeCardText(payload));
  showNotice(
    ok
      ? "Card copied — paste it in any holon (or any chat)."
      : "Couldn't reach the clipboard.",
  );
}

/**
 * Land pasted text as a card in the displayed holon. Returns false when the
 * text contains no card payload (so callers can let a normal paste proceed);
 * true when it was a card — handled here, outcome shown via the notice.
 */
export async function pasteCardText(text: string): Promise<boolean> {
  const card = parseCardText(text);
  if (!card) return false;
  const hid = get(holonId);
  if (!hid) {
    showNotice("Point the kiosk at a holon first.");
    return true;
  }
  const user = get(telegramUser);
  if (!user) {
    showNotice("Log in to paste the copied card.");
    loginOpen.set(true);
    return true;
  }
  try {
    if (card.kind === "quest") {
      const quest = questFromCard(card, {
        holonId: hid,
        initiator: {
          id: user.id,
          username: user.username,
          firstName: user.first_name,
          lastName: user.last_name,
        },
      });
      quest.id = newId();
      const writer = await getWriter(hid, (m) =>
        showNotice(`Couldn't paste — ${m}`),
      );
      if (await writer.put("quests", quest)) {
        showNotice(`Pasted "${quest.title}".`);
      }
    } else {
      const { itemId, options } = libraryAddFromCard(card, {
        createdBy: user.id,
        createdByUsername: user.username,
      });
      const db = await getLibraryDb();
      const res = await addItem(db, hid, itemId, options);
      if (res.ok) showNotice(`Pasted "${itemId}" into the library.`);
      else if (res.reason === "already_exists")
        showNotice(`"${itemId}" is already in this library.`);
      else showNotice("Couldn't paste the card.");
    }
  } catch (err) {
    console.error("[kiosk] paste card failed", err);
    showNotice(
      `Couldn't paste — ${err instanceof Error ? err.message : "write failed"}`,
    );
  }
  return true;
}

/**
 * Touch-friendly paste entry point (no keyboard): read the system clipboard
 * and land whatever card it holds. Reading needs the async Clipboard API and
 * a permission grant — report failure rather than silently doing nothing.
 */
export async function pasteFromSystemClipboard(): Promise<void> {
  let text = "";
  try {
    text = await navigator.clipboard.readText();
  } catch {
    showNotice("Clipboard blocked — press Ctrl/Cmd+V instead.");
    return;
  }
  if (!text || !(await pasteCardText(text))) {
    showNotice("No copied card in the clipboard.");
  }
}
