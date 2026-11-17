// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Starting a fund or a project, and looking after who holds its keys. The
// rules are core's: `startHolon` founds it with the key signed in here (that
// key is its first admin), `addHolonMember`/`removeHolonMember` seat and
// unseat keys, and every split change after that is a split proposal.
//
// Only a person's own key may start one. A Telegram sign-in writes with
// this device's key, which a cleared browser loses — and with it the only
// admin of the holon.

import { startHolon } from "@holons/core/flows";
import {
  addHolonMember,
  holonMembers,
  removeHolonMember,
  type Role,
} from "@holons/core/protocol";
import { get } from "svelte/store";
import { currentUser } from "./auth";
import { adopt, choosePot, potId, refine, snapshot } from "./graph";
import { getHolosphere } from "./holosphere";
import { rememberSteered } from "./me";
import { sessionKeyPub } from "./sessionKey";

/** Whether this session signs with the person's own key. */
export const signsAsSelf = (): boolean => !!get(sessionKeyPub);

/** Is there no Pot on this device to start a holon under — no map at all? */
export const noPot = (): boolean => !potId || !get(snapshot).graph;

/**
 * Start a holon; resolves its id once the map can show it. On a device with
 * no Pot yet it becomes the Pot: the map opens on it, and everything later
 * seated or linked hangs from it.
 */
export async function start(input: {
  name: string;
  description?: string;
}): Promise<string> {
  if (!signsAsSelf()) throw new Error("Sign in with your own key first");
  const { holon } = await startHolon(await getHolosphere(), input);
  const self = get(currentUser);
  if (self) rememberSteered(String(self.id), holon);
  if (noPot()) await choosePot(holon);
  else await adopt(holon);
  return holon;
}

export interface HolonKey {
  key: string;
  role: Role;
}

/** The keys seated in a holon's members log, admins first. Quiet: none when unreadable. */
export async function holonKeys(holon: string): Promise<HolonKey[]> {
  try {
    const members = await holonMembers(await getHolosphere(), holon);
    return [...members]
      .map(([key, role]) => ({ key, role }))
      .sort(
        (a, b) =>
          (a.role === "admin" ? 0 : 1) - (b.role === "admin" ? 0 : 1) ||
          a.key.localeCompare(b.key),
      );
  } catch {
    return [];
  }
}

/** Seat a key (hex or npub) as an admin or a member. Admins only. */
export async function seatKey(
  holon: string,
  key: string,
  role: Role,
): Promise<string> {
  const pub = await addHolonMember(await getHolosphere(), holon, key, role);
  void refine(holon, true);
  return pub;
}

/** Unseat a key. Admins only; never one's own. */
export async function unseatKey(holon: string, key: string): Promise<void> {
  await removeHolonMember(await getHolosphere(), holon, key);
}
