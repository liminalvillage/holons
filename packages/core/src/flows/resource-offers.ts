// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Resource offers — what a holon makes available, and on what terms.
 *
 * A seed bank offers a workspace, a tool library and design hours. Each is a
 * RESOURCE OFFER: one of the eight capitals, a title, and its TERMS OF
 * ACCESS — when it can be had, for whom, and how to ask. Terms are part of
 * the offer, stored on the holon's public settings document beside its
 * split, so they are visible to everyone who can read the holon and nobody
 * gets a resource on terms the others cannot see.
 *
 * A gift that answers an offer names it (`GiveBody.offer`), which is how an
 * offer's use is traced back to it.
 *
 * Pure: settings in, offers out. Saving is `resources-load.ts`, admin-only.
 */

import { normalizeCapital, type Capital } from './resources.js';

/** Where offers live on the settings document. */
export const RESOURCE_OFFERS_KEY = 'resourceOffers';
export const RESOURCE_OFFERS_MAX = 50;

/** The terms of access: when, for whom, how. Each is plain words. */
export interface ResourceTerms {
  when?: string;
  who?: string;
  how?: string;
}

export interface ResourceOffer {
  /** Stable within the holon: what a gift's `offer` names. */
  id: string;
  capital: Capital;
  title: string;
  /** What is on offer, counted: 20 hours, 2 desks. */
  quantity?: number;
  unit?: string;
  terms: ResourceTerms;
  note?: string;
}

const clip = (raw: unknown, max: number): string | undefined => {
  const s = String(raw ?? '').trim().slice(0, max);
  return s || undefined;
};

/** An id from a title: lower-case words joined by dashes. */
export function offerIdOf(title: string): string {
  return String(title ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** A stored or typed offer as a usable one, or null when it has no capital or title. */
export function normalizeResourceOffer(raw: unknown): ResourceOffer | null {
  if (!raw || typeof raw !== 'object') return null;
  const doc = raw as Record<string, unknown>;
  const capital = normalizeCapital(doc.capital);
  const title = clip(doc.title, 120);
  if (!capital || !title) return null;
  const id = offerIdOf(String(doc.id ?? '')) || offerIdOf(title);
  if (!id) return null;
  const termsRaw = (doc.terms ?? {}) as Record<string, unknown>;
  const terms: ResourceTerms = {
    ...(clip(termsRaw.when, 200) ? { when: clip(termsRaw.when, 200) } : {}),
    ...(clip(termsRaw.who, 200) ? { who: clip(termsRaw.who, 200) } : {}),
    ...(clip(termsRaw.how, 200) ? { how: clip(termsRaw.how, 200) } : {}),
  };
  const quantity = Number(doc.quantity);
  const unit = clip(doc.unit, 40);
  const note = clip(doc.note, 500);
  return {
    id,
    capital,
    title,
    ...(Number.isFinite(quantity) && quantity > 0 ? { quantity: Math.round(quantity * 100) / 100 } : {}),
    ...(unit ? { unit } : {}),
    terms,
    ...(note ? { note } : {}),
  };
}

/** A holon's offers, as stored on its settings document: usable ones, one per id, in order. */
export function readResourceOffers(settings: unknown): ResourceOffer[] {
  const list = ((settings ?? {}) as Record<string, unknown>)[RESOURCE_OFFERS_KEY];
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: ResourceOffer[] = [];
  for (const raw of list) {
    const offer = normalizeResourceOffer(raw);
    if (!offer || seen.has(offer.id)) continue;
    seen.add(offer.id);
    out.push(offer);
    if (out.length >= RESOURCE_OFFERS_MAX) break;
  }
  return out;
}

/** True when all three terms are said. An offer without them is shown as such. */
export const hasFullTerms = (offer: Pick<ResourceOffer, 'terms'>): boolean => !!(offer.terms.when && offer.terms.who && offer.terms.how);

/** The list with `offer` added, or replacing the one with its id. */
export function withResourceOffer(list: readonly ResourceOffer[], raw: unknown): ResourceOffer[] {
  const offer = normalizeResourceOffer(raw);
  if (!offer) throw new Error('An offer has one of the eight capitals and a title');
  const at = list.findIndex((o) => o.id === offer.id);
  if (at >= 0) return list.map((o, i) => (i === at ? offer : o));
  if (list.length >= RESOURCE_OFFERS_MAX) throw new Error(`A holon lists at most ${RESOURCE_OFFERS_MAX} offers`);
  return [...list, offer];
}

/** The list without the offer `id`. */
export function withoutResourceOffer(list: readonly ResourceOffer[], id: string): ResourceOffer[] {
  return list.filter((o) => o.id !== id);
}
