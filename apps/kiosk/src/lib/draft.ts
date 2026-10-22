// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Drafting a map record from a description, through the kiosk's own
// /api/ai/draft function, which holds the Claude key in the deploy's server
// env — never on a device. Availability is probed once.
//
// All meaning — the answer's schema, the prompt, the validation of what comes
// back — lives in @holons/core/drafting. This module only routes the call.

import {
  parseDraft,
  type DraftField,
  type DraftValues,
} from "@holons/core/drafting";
import { tr } from "./i18n";

let serverProbe: Promise<boolean> | null = null;
function serverConfigured(): Promise<boolean> {
  if (!serverProbe) {
    serverProbe = fetch("/api/ai/draft")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !!(d as { configured?: boolean } | null)?.configured)
      .catch(() => false);
  }
  return serverProbe;
}

/** Whether this kiosk can draft at all (its deploy holds the AI key). */
export function draftAvailable(): Promise<boolean> {
  return serverConfigured();
}

export interface DraftRequestInput {
  /** What is being described, in the lens's own word ("Projects"). */
  kind: string;
  description: string;
  fields: readonly DraftField[];
  place?: { lat: number; lon: number } | null;
}

/**
 * Fill in what the description says, leaving the rest empty. Throws an
 * `Error` carrying a kiosk-friendly message when there is no way to ask.
 */
export async function requestDraft(
  input: DraftRequestInput,
): Promise<DraftValues> {
  if (!(await serverConfigured())) throw new Error(tr("draft.unavailable"));
  const res = await fetch("/api/ai/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as {
    values?: unknown;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data?.error || tr("draft.failed", { status: res.status }));
  }
  // The route already validated; never trust parsed network input.
  return parseDraft(data.values, input.fields);
}
