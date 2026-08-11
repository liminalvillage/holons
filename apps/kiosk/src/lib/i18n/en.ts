// SPDX-License-Identifier: AGPL-3.0-or-later
//
// English catalog — the source of truth. Keys are dot-namespaced by the
// component/module that owns the string; `{name}` marks an interpolation
// slot. `it.ts` and `es.ts` must cover exactly this key set (enforced by
// their `Record<MessageKey, Msg>` type and the parity spec).

import type { Msg } from "./types";

export const en = {
  // Shared
  "common.auto": "Auto",

  // Settings panel
  "settings.language": "Language",
  "settings.languageSub": "— Auto follows the holon's language",
} as const satisfies Record<string, Msg>;

export type MessageKey = keyof typeof en;
