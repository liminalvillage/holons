// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Resources: what reaches an account that is not its share of the Pot —
// space, tools, seeds, skills, time, and money as one stream among eight.
// The rules are core's (`@holons/core/flows` resources): anyone may give, on
// the recipient's own log; it counts once the recipient's steward receives
// it; offers carry their terms on the holon's public settings.

import {
  EMPTY_RESOURCE_BASE,
  disputeGift,
  giveResource,
  loadResources,
  receiveGift,
  removeResourceOffer,
  saveResourceOffer,
  type BuildGiftInput,
  type ResourceOffer,
  type ResourcesContext,
} from "@holons/core/flows";
import { getHolosphere } from "./holosphere";

export const EMPTY_RESOURCES: ResourcesContext = {
  gifts: [],
  received: [],
  pending: [],
  base: EMPTY_RESOURCE_BASE,
  offers: [],
};

const cache = new Map<string, Promise<ResourcesContext>>();

/** An account's gifts and offers. Quiet: one that cannot be read has none. */
export function accountResources(
  id: string,
  force = false,
): Promise<ResourcesContext> {
  if (!force && cache.has(id)) return cache.get(id)!;
  const read = (async () => {
    try {
      return await loadResources(await getHolosphere(), id);
    } catch {
      return EMPTY_RESOURCES;
    }
  })();
  cache.set(id, read);
  return read;
}

export async function give(to: string, input: BuildGiftInput): Promise<void> {
  await giveResource(await getHolosphere(), to, input);
  cache.delete(to);
}

export async function receive(holon: string, giftId: string): Promise<void> {
  await receiveGift(await getHolosphere(), holon, giftId);
  cache.delete(holon);
}

export async function dispute(
  holon: string,
  giftId: string,
  reason: string,
): Promise<void> {
  await disputeGift(await getHolosphere(), holon, giftId, reason);
  cache.delete(holon);
}

export async function saveOffer(
  holon: string,
  offer: Partial<ResourceOffer>,
): Promise<void> {
  await saveResourceOffer(await getHolosphere(), holon, offer);
  cache.delete(holon);
}

export async function removeOffer(holon: string, id: string): Promise<void> {
  await removeResourceOffer(await getHolosphere(), holon, id);
  cache.delete(holon);
}
