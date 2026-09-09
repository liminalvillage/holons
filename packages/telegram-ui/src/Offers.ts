// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// /offer on the bot, over @holons/core/offers. The command line is the
// whole offer:
//
//   /offer 5kg flour                → give 5 kg of flour
//   /offer 2 hours plumbing #skills → give 2 hours, category skills
//   /offer lend ladder              → lend one ladder
//   /offer sell 12 eggs for 4 EUR   → sell 12, price per unit
//   /offer bike                     → give one bike
//
// A leading verb sets the mode, a leading quantity (with an optional unit,
// as /stock reads it) sets the supply, `#word` sets the category, and a
// trailing `for <price> [currency]` sets the price. What is left is the
// title. Pure parsing here, exported for tests; the handler in Quests.ts
// builds the record and publishes it.

import { parseQuantityLine } from './Stock.js';
import type { OfferMode } from '@holons/core/offers';

export interface ParsedOffer {
  title: string;
  quantity: number;
  unit: string;
  mode: OfferMode;
  category?: string;
  price?: number;
  currency?: string;
  itemType: 'good' | 'service';
}

const MODE_WORDS: Record<string, OfferMode> = {
  give: 'give',
  gift: 'give',
  donate: 'give',
  dono: 'give',
  regalo: 'give',
  doy: 'give',
  lend: 'lend',
  loan: 'lend',
  presto: 'lend',
  sell: 'sell',
  vendo: 'sell',
  vend: 'sell',
};

const SERVICE_UNITS = new Set([
  'hour',
  'hours',
  'hr',
  'hrs',
  'h',
  'ora',
  'ore',
  'hora',
  'horas',
  'day',
  'days',
]);

/** Parse the text after `/offer`. Null when nothing is left for a title. */
export function parseOfferText(text: string): ParsedOffer | null {
  let rest = (text ?? '').trim();
  if (!rest) return null;

  let mode: OfferMode = 'give';
  const verb = rest.split(/\s+/)[0]?.toLowerCase() ?? '';
  if (verb in MODE_WORDS) {
    mode = MODE_WORDS[verb];
    rest = rest.slice(verb.length).trim();
  }

  let price: number | undefined;
  let currency: string | undefined;
  const priceMatch = rest.match(
    /\s+(?:for|per|a|por)\s+(\d+(?:[.,]\d+)?)\s*([A-Za-z€$£]{1,4})?\s*$/i
  );
  if (priceMatch) {
    price = Number(priceMatch[1].replace(',', '.'));
    currency = priceMatch[2] ? normalizeCurrency(priceMatch[2]) : 'EUR';
    rest = rest.slice(0, priceMatch.index).trim();
    if (mode === 'give') mode = 'sell';
  }

  let category: string | undefined;
  rest = rest
    .replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (_m, _pre, tag: string) => {
      category = category ?? tag.toLowerCase();
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();

  let quantity = 1;
  let unit = 'one';
  let title = rest;
  // Time first: "2 hours plumbing" is a service, a unit /stock does not keep.
  const time = rest.match(
    /^(\d+(?:[.,]\d+)?)\s*(hours?|hrs?|h|ore|ora|horas?|days?)\b\s*(.*)$/i
  );
  if (time && SERVICE_UNITS.has(time[2].toLowerCase())) {
    quantity = Number(time[1].replace(',', '.'));
    unit = 'hour';
    title = time[3];
  } else {
    const qty = parseQuantityLine(rest);
    if (qty && qty.quantity > 0) {
      quantity = qty.quantity;
      unit = qty.unit ?? 'one';
      title = [qty.item, qty.note].filter(Boolean).join(' ');
    }
  }
  title = title.trim();
  if (!title) return null;

  const itemType = unit === 'hour' ? 'service' : 'good';
  return {
    title,
    quantity,
    unit,
    mode,
    ...(category ? { category } : {}),
    ...(price != null ? { price, currency } : {}),
    itemType,
  };
}

function normalizeCurrency(raw: string): string {
  const c = raw.trim();
  if (c === '€') return 'EUR';
  if (c === '$') return 'USD';
  if (c === '£') return 'GBP';
  return c.toUpperCase();
}
