// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Resources against the store: reading a holon's `flow_resources` log and
 * its offers, giving, the recipient admin's two answers, and editing the
 * offers.
 *
 * Giving is open — anyone may append a gift to anyone's log, the way anyone
 * may apply to a fund — because a gift counts only once the recipient's
 * admin receives it. Receiving, disputing and editing offers are admin-only,
 * checked here before anything is written.
 *
 * Eventually consistent: a lens that has not arrived reads as empty.
 */

import { isHolonAdmin, resolveHolonAuthority } from '../holosphere/authority.js';
import { RESOURCE_OFFERS_KEY, readResourceOffers, withResourceOffer, withoutResourceOffer, type ResourceOffer } from './resource-offers.js';
import {
  FLOW_RESOURCES_LENS,
  buildGift,
  buildGiftVerdict,
  foldResources,
  type BuildGiftInput,
  type FoldedResources,
  type ResourceBase,
  type ResourceGift,
} from './resources.js';

const quiet = <T>(p: Promise<T>, fallback: T): Promise<T> => p.then((v) => v ?? fallback).catch(() => fallback);

export interface ResourcesContext extends FoldedResources {
  /** What the holon offers, with its terms. */
  offers: ResourceOffer[];
}

/** Does this key speak for this party, as far as this instance can see? */
function speaksFor(holosphere: any) {
  const cache = new Map<string, ReturnType<typeof resolveHolonAuthority>['actors']>();
  return (pubkey: string, party: string, at: number): boolean => {
    const key = String(pubkey).toLowerCase();
    if (key === String(party).toLowerCase()) return true;
    if (!cache.has(party)) cache.set(party, resolveHolonAuthority(holosphere, party).actors);
    return !!cache.get(party)?.isAcceptedAt(key, at);
  };
}

/** A holon's gifts, folded, and its offers. */
export async function loadResources(holosphere: any, holonId: string): Promise<ResourcesContext> {
  const holon = String(holonId ?? '');
  // Pull the lens before reading the log off the local store.
  await quiet(holosphere.getAll(holon, FLOW_RESOURCES_LENS), []);
  const [entries, settings] = await Promise.all([
    quiet<any[]>(Promise.resolve().then(() => holosphere.getLog(holon, FLOW_RESOURCES_LENS)), []),
    quiet<any>(holosphere.get(holon, 'settings', holon), null),
  ]);
  const folded = foldResources({
    entries,
    actors: resolveHolonAuthority(holosphere, holon).actors,
    actsFor: speaksFor(holosphere),
  });
  return { ...folded, offers: readResourceOffers(settings) };
}

/** Give `holonId` a resource. It counts once the holon's admin receives it. */
export async function giveResource(holosphere: any, holonId: string, input: BuildGiftInput): Promise<{ id: string }> {
  const holon = String(holonId ?? '');
  if (!holon) throw new Error('A gift names who it is for');
  if (String(input.from ?? '').trim() === holon) throw new Error('A holon does not give to itself');
  if (input.offer) {
    const settings = await quiet<any>(holosphere.get(holon, 'settings', holon), null);
    if (!readResourceOffers(settings).some((o) => o.id === input.offer)) throw new Error('That offer is not on this holon');
  }
  const g = buildGift(input);
  const event = await holosphere.append(holon, FLOW_RESOURCES_LENS, g.item, { refs: g.refs });
  return { id: event.id };
}

async function decidable(holosphere: any, holonId: string, giftId: string): Promise<ResourceGift> {
  if (!(await isHolonAdmin(holosphere, holonId))) throw new Error('Only an admin of the holon receives its gifts');
  const ctx = await loadResources(holosphere, holonId);
  const found = ctx.gifts.find((g) => g.id === giftId);
  if (!found) throw new Error('That gift is not on this holon');
  return found;
}

/** Say a gift arrived: from now on it is in the holon's resource base. */
export async function receiveGift(holosphere: any, holonId: string, giftId: string): Promise<ResourceGift> {
  const found = await decidable(holosphere, holonId, giftId);
  const v = buildGiftVerdict(found.id, 'attest');
  await holosphere.append(String(holonId), FLOW_RESOURCES_LENS, v.item, { refs: v.refs });
  return { ...found, status: 'received' };
}

/** Say a gift did not arrive (or not as written), with a reason everyone can read. */
export async function disputeGift(holosphere: any, holonId: string, giftId: string, reason: string): Promise<ResourceGift> {
  const why = String(reason ?? '').trim();
  if (!why) throw new Error('A dispute says why');
  const found = await decidable(holosphere, holonId, giftId);
  const v = buildGiftVerdict(found.id, 'dispute', why);
  await holosphere.append(String(holonId), FLOW_RESOURCES_LENS, v.item, { refs: v.refs });
  return { ...found, status: 'disputed', reason: why };
}

async function writeOffers(holosphere: any, holonId: string, edit: (list: ResourceOffer[]) => ResourceOffer[]): Promise<ResourceOffer[]> {
  const holon = String(holonId ?? '');
  if (!(await isHolonAdmin(holosphere, holon))) throw new Error('Only an admin of the holon edits its offers');
  // A failed read must not wipe the rest of the settings document.
  const existing = await holosphere.get(holon, 'settings', holon);
  const next = edit(readResourceOffers(existing));
  await holosphere.put(holon, 'settings', { ...(existing ?? {}), id: holon, [RESOURCE_OFFERS_KEY]: next });
  return next;
}

/** Add an offer, or replace the one with its id. */
export const saveResourceOffer = (holosphere: any, holonId: string, offer: unknown): Promise<ResourceOffer[]> =>
  writeOffers(holosphere, holonId, (list) => withResourceOffer(list, offer));

/** Take an offer down. Gifts that answered it keep naming it. */
export const removeResourceOffer = (holosphere: any, holonId: string, offerId: string): Promise<ResourceOffer[]> =>
  writeOffers(holosphere, holonId, (list) => withoutResourceOffer(list, offerId));

/** The resource-base lookup a cascade, a cut or a crawl injects: one read per holon, quiet. */
export const resourcesOf =
  (holosphere: any) =>
  async (holonId: string): Promise<ResourceBase> =>
    (await loadResources(holosphere, holonId)).base;
