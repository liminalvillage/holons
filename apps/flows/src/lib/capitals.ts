// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The eight forms of capital as the app shows them: core's order
// (`CAPITALS`, financial last), a colour token each (app.css `--cap-*`), and
// the words for each. What a capital means is core's; this is only its look.

import { CAPITALS, type Capital } from "@holons/core/flows";
import type { MessageKey } from "./i18n";

export { CAPITALS, type Capital };

/** The CSS colour of a capital. */
export const capitalColour = (c: Capital): string => `var(--cap-${c})`;

/** The catalog key naming a capital. */
export const capitalName = (c: Capital): MessageKey =>
  `capital.${c}` as MessageKey;

/** The catalog key with a few words of what a capital is. */
export const capitalHint = (c: Capital): MessageKey =>
  `capital.${c}.hint` as MessageKey;

/** A by-capital count as rows in core's order, the empty ones dropped. */
export function capitalRows(
  byCapital: Partial<Record<Capital, number>> | null | undefined,
): { capital: Capital; n: number }[] {
  return CAPITALS.map((capital) => ({
    capital,
    n: Math.max(0, Math.floor(Number(byCapital?.[capital]) || 0)),
  })).filter((r) => r.n > 0);
}
