// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The badge on a join request: where the request stands with the holon's
// DNA as it is now. Core decides (`joinReadiness`); this only picks the
// words and the tone. A holon that asks no agreement shows no badge.

import type { JoinReadiness } from "@holons/core/holons";
import type { CopyKey } from "./copy";

export type BadgeTone = "ok" | "warn" | "bad" | "muted";

export interface ReadinessBadge {
  key: CopyKey;
  tone: BadgeTone;
}

/** The badge for a request's readiness, or null when there is nothing to say. */
export function readinessBadge(
  readiness: JoinReadiness,
): ReadinessBadge | null {
  switch (readiness) {
    case "acknowledged":
      return { key: "ready.acknowledged", tone: "ok" };
    case "outdated":
      return { key: "ready.outdated", tone: "warn" };
    case "missing":
      return { key: "ready.missing", tone: "bad" };
    case "unknown":
      return { key: "ready.unknown", tone: "muted" };
    default:
      return null;
  }
}
