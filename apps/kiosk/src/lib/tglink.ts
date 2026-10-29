// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The screen's side of linking a Telegram chat to a hub founded here
// (@holons/core/linking owns the handshake; this is the wait, the links and
// the local memory around it — the same shape as hubclaim.ts):
//
//   offer   an admin's key writes the offer; the token leaves in a deep link
//   wait    the bot answers with a claim record naming the chat; the chat's
//           own signed acceptance is what the screen believes
//   confirm a human reads the chat's title and says yes; the bot key is
//           seated as an admin here and the two holons federate
//
// The pending offer lives in localStorage so a return from Telegram — or a
// reload — picks the wait back up instead of starting over.

import { writable } from "svelte/store";
import type { HoloSphere } from "holosphere";
import {
  LINK_MAX_AGE_MS,
  completeTelegramLink,
  federateLinkedChat,
  isLinkId,
  linkPayload,
  offerTelegramLink,
  unfederateLinkedChat,
  unlinkTelegram,
  watchTelegramLink as coreWatchTelegramLink,
  type LinkAccept,
  type LinkRecord,
} from "@holons/core/linking";
import { isClaimToken, type ClaimWatchStore } from "@holons/core/claims";
import { isHolonId } from "@holons/core/protocol";
import { addToGroupUrl, botChatUrl, markBotHandoff } from "./config";
import { rememberBoard } from "./dock";

const PENDING_KEY = "kiosk_tg_link";

/** An offer this screen sent out and is still waiting on. */
export type PendingLink = {
  hub: string;
  token: string;
  id: string;
  at: number;
};

/** Opened by the layout when a pending link is found on return from Telegram. */
export const telegramLinkOpen = writable<boolean>(false);

/** Parse the persisted note; null when absent, malformed, stale, or for another hub. */
export function parsePendingLink(
  raw: string | null,
  now = Date.now(),
  hub?: string,
): PendingLink | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PendingLink>;
    if (!isHolonId(v.hub) || !isClaimToken(v.token) || !isLinkId(v.id))
      return null;
    if (typeof v.at !== "number" || !Number.isFinite(v.at)) return null;
    if (now - v.at > LINK_MAX_AGE_MS || v.at > now + 60_000) return null;
    if (hub !== undefined && v.hub !== hub) return null;
    return { hub: v.hub, token: v.token, id: v.id, at: v.at };
  } catch {
    return null;
  }
}

/** The link this device is waiting on (for `hub`, when given); a stale one is forgotten. */
export function pendingLink(
  hub?: string,
  now = Date.now(),
): PendingLink | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const p = parsePendingLink(raw, now);
    if (!p && raw) localStorage.removeItem(PENDING_KEY);
    return p && (hub === undefined || p.hub === hub) ? p : null;
  } catch {
    return null;
  }
}

/** Both deep links, carrying the payload out: a chat with the bot, or a group. */
export function telegramLinkUrls(
  hub: string,
  token: string,
): { personal: string; group: string } {
  const payload = linkPayload(hub, token);
  return { personal: botChatUrl(payload), group: addToGroupUrl(payload) };
}

/**
 * Offer the link (an admin's signed record in the hub) and remember the
 * token here — the only copy, for the deep links.
 */
export async function beginTelegramLink(
  hs: HoloSphere,
  hub: string,
  now = Date.now(),
): Promise<PendingLink> {
  const { token, id } = await offerTelegramLink(hs, hub, { now });
  const p: PendingLink = { hub, token, id, at: now };
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    /* private mode / quota — the wait just won't survive a reload */
  }
  return p;
}

/** Leaving for Telegram: leave the hand-off note so the return leg opens the right sheet. */
export function handOffTelegramLink(): void {
  markBotHandoff();
}

/** The loop closed (or was abandoned): nothing to wait on any more. */
export function clearTelegramLink(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Watch for the bot's answer (core's `watchTelegramLink`): the claim names
 * the chat, and the chat's own signed acceptance is what is handed on.
 * Fires at most once; returns a stop function.
 */
export function watchTelegramLink(
  holosphere: Promise<HoloSphere> | HoloSphere,
  pending: PendingLink,
  onAccepted: (accept: LinkAccept) => void,
  opts: Parameters<typeof coreWatchTelegramLink>[3] = {},
): () => void {
  return coreWatchTelegramLink(
    holosphere as Promise<HoloSphere & ClaimWatchStore>,
    { holon: pending.hub, id: pending.id },
    onAccepted,
    opts,
  );
}

/**
 * A human said yes: mark the hub linked, seat the chat's key as admin,
 * federate every board lens both ways, and dock the chat beside the hub.
 */
export async function confirmTelegramLink(
  hs: HoloSphere,
  pending: PendingLink,
  accept: LinkAccept,
): Promise<LinkRecord> {
  const name = accept.record.chat?.title?.trim() || accept.chat;
  const record = await completeTelegramLink(hs, {
    holon: pending.hub,
    id: pending.id,
    chat: accept.chat,
    anchor: accept.anchor,
    name,
  });
  try {
    await federateLinkedChat(hs, pending.hub, accept.chat, name);
  } catch (err) {
    console.warn("[kiosk] linked, but could not federate the pair", err);
  }
  rememberBoard(accept.chat, name, { via: pending.hub });
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("kiosk:federation-changed"));
  clearTelegramLink();
  return record;
}

/** Drop a link: the hub's record, the bot key's seat, and the federation. */
export async function unlinkTelegramChat(
  hs: HoloSphere,
  hub: string,
  link: LinkRecord,
): Promise<boolean> {
  const gone = await unlinkTelegram(hs, hub, link.id);
  if (!gone) return false;
  if (link.peer) {
    try {
      await unfederateLinkedChat(hs, hub, link.peer);
    } catch (err) {
      console.warn("[kiosk] unlinked, but could not unfederate the pair", err);
    }
  }
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("kiosk:federation-changed"));
  return true;
}
