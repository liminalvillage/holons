// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Drafting a map record from a description — the same two transports as the
// task breakdown next door, resolved per request:
//
//   1. A key pasted on THIS device (Settings → localStorage, or
//      VITE_OPENAI_API_KEY for a self-hosted build) → the browser calls
//      OpenAI directly. A pasted key is an explicit caretaker choice, so it
//      outranks the server route.
//   2. Otherwise the kiosk's own /api/ai/draft function, which holds the key
//      in the deploy's server env. Availability is probed once.
//
// All meaning — the tool schema, the prompt, the validation of what comes
// back — lives in @holons/core/drafting. This module only routes the call.

import {
  DRAFT_TOOL_NAME,
  DraftValidationError,
  buildDraftPrompt,
  buildDraftTool,
  parseDraft,
  type DraftField,
  type DraftValues,
} from "@holons/core/drafting";
import { resolveVoiceKey } from "./config";
import { tr } from "./i18n";

/** Same CORS-friendly host the direct voice mode talks to. */
const API_BASE = "https://api.openai.com/v1";
/** Matches the route's fallback model. */
const DRAFT_MODEL = "gpt-4o";

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

/** Whether this kiosk can draft at all (a device key OR a server key). */
export async function draftAvailable(): Promise<boolean> {
  if (resolveVoiceKey()) return true;
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
  const key = resolveVoiceKey();
  if (key) return viaOpenAI(key, input);
  if (await serverConfigured()) return viaServer(input);
  throw new Error(tr("draft.unavailable"));
}

/** The kiosk's own session-gated route (the key stays server-side). */
async function viaServer(input: DraftRequestInput): Promise<DraftValues> {
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

/** One forced-tool chat-completions call straight from the browser. */
async function viaOpenAI(
  key: string,
  input: DraftRequestInput,
): Promise<DraftValues> {
  const prompt = buildDraftPrompt(input);
  const tool = buildDraftTool(input.fields);
  const resp = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: DRAFT_MODEL,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema,
            strict: true,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: DRAFT_TOOL_NAME } },
    }),
  });
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403)
      throw new Error(tr("breakdown.badKey"));
    if (resp.status === 429) throw new Error(tr("breakdown.rateLimit"));
    throw new Error(tr("draft.failed", { status: resp.status }));
  }
  const data = (await resp.json()) as {
    choices?: {
      message?: { tool_calls?: { function?: { arguments?: unknown } }[] };
    }[];
  };
  const args =
    data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (typeof args !== "string") {
    throw new DraftValidationError("the model returned no fields");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    throw new DraftValidationError("the model returned malformed JSON");
  }
  return parseDraft(parsed, input.fields);
}
