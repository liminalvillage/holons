// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What this deployment calls a holon. `VITE_HOLON_NOUN` (root `.env`) wins,
// else the serving host decides (hubs.network → hub), else "holon". On SSR
// there is no `location`, so only the setting applies there.
import {
  fillHolonNoun,
  holonWords,
  resolveHolonNoun,
} from "@holons/core/vocabulary";

export const HOLON_NOUN = resolveHolonNoun({
  setting: import.meta.env.VITE_HOLON_NOUN,
  host: typeof location !== "undefined" ? location.hostname : null,
});

export const words = holonWords(HOLON_NOUN, "en");

/** Fill the `{@holon}`-style tokens in `text`. */
export function nn(text: string): string {
  return fillHolonNoun(text, words);
}
