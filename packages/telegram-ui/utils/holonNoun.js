// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import {
  fillHolonNoun,
  holonWords,
  resolveHolonNoun,
} from '@holons/core/vocabulary';

/**
 * Fill the `{@holon}`-style tokens in a hardcoded bot string with the noun
 * this deployment uses (`VITE_HOLON_NOUN` in the bot's .env: "hub",
 * "holon", …). Locale strings get the same treatment from the i18next
 * post-processor; this is for copy that does not go through i18next.
 */
export function holonText(text, lang = 'en') {
  const noun = resolveHolonNoun({ setting: process.env.VITE_HOLON_NOUN });
  return fillHolonNoun(String(text), holonWords(noun, lang));
}
