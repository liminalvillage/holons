// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The holon's currency list (`settings.currencies`): the units its expense
// sheets offer before anyone has used them, and what the value equation
// weighs. A currency also exists the moment an expense records it, so the
// list a UI offers is this one plus those in use (`currencyUsage`); only the
// listed ones can be taken off — a currency on a record stays until the
// record changes.
//
// Codes are normalized the way every expense writer normalizes them
// (`normalizeCurrency`: lowercase, singular, letters only), so "Euros" and
// "euro" are one entry.

import { expenseCurrency, normalizeCurrency } from '../expenses/index.js';

/** Normalize, drop blanks, keep the first of each — order preserved. */
export function normalizeCurrencyList(codes: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const raw of codes) {
    if (typeof raw !== 'string') continue;
    const code = normalizeCurrency(raw);
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

/** The listed currencies of a settings document, normalized. */
export function readHolonCurrencies(settings: unknown): string[] {
  const list = (settings as { currencies?: unknown } | null)?.currencies;
  return Array.isArray(list) ? normalizeCurrencyList(list) : [];
}

/** How many expense records use each currency. */
export function currencyUsage(
  expenses: readonly unknown[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of expenses) {
    if (!e || typeof e !== 'object') continue;
    const code = expenseCurrency(e as any);
    if (code) out[code] = (out[code] ?? 0) + 1;
  }
  return out;
}

/**
 * Write the holon's currency list. The rest of the settings document is
 * kept as read; on a failed read the document carries the list alone.
 * Returns the list as written.
 */
export async function saveHolonCurrencies(
  holosphere: any,
  holonId: string,
  codes: readonly unknown[],
): Promise<string[]> {
  const list = normalizeCurrencyList(codes);
  let existing: any = null;
  try {
    existing = await holosphere.get(String(holonId), 'settings', String(holonId));
  } catch {
    // A failed read must not cost the edit.
  }
  await holosphere.put(String(holonId), 'settings', {
    ...(existing ?? {}),
    id: String(holonId),
    currencies: list,
  });
  return list;
}
