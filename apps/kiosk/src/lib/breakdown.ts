// SPDX-License-Identifier: AGPL-3.0-or-later
//
// AI task breakdown for the kiosk — the same feature as the web dashboard's
// /api/ai/breakdown. Two transports, resolved per request:
//
//   1. A key pasted on THIS device (Settings → localStorage, with
//      VITE_OPENAI_API_KEY as the dev/self-hosted fallback — the same key the
//      "direct" voice mode speaks with) → the browser calls OpenAI directly.
//      A pasted key is an explicit caretaker choice, so it outranks the
//      server route, matching how the voice backend is resolved.
//   2. Otherwise, the kiosk's own /api/ai/breakdown serverless function,
//      which holds the key in the deploy's server env (e.g. Netlify site
//      config) — never in the bundle. Availability is probed once via GET.
//
// All meaning — tool schema, prompt, proposal validation, materialization —
// lives in @holons/core/tasks; this module only routes the HTTP call.

import {
  PROPOSE_STEPS_TOOL,
  PROPOSE_STEPS_TOOL_NAME,
  BREAKDOWN_MAX_GOAL_DESCRIPTION_CHARS,
  BreakdownValidationError,
  buildBreakdownPrompt,
  parseBreakdownProposal,
  toBreakdownContext,
  type BreakdownContextTask,
  type BreakdownProposal,
  type Quest,
} from "@holons/core/tasks";
import { resolveVoiceKey } from "./config";

/** Same CORS-friendly host the direct voice mode talks to (voice/openai.ts). */
const API_BASE = "https://api.openai.com/v1";

/** Matches the web route's OpenAI fallback model (DEFAULT_OPENAI_MODEL). */
const BREAKDOWN_MODEL = "gpt-4o";

// Whether the deploy's serverless function holds an OpenAI key, probed once
// per page load. A static/self-hosted build without functions 404s → false.
let serverProbe: Promise<boolean> | null = null;
function serverConfigured(): Promise<boolean> {
  if (!serverProbe) {
    serverProbe = fetch("/api/ai/breakdown")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !!(d as { configured?: boolean } | null)?.configured)
      .catch(() => false);
  }
  return serverProbe;
}

/** Whether this kiosk can break tasks down (a device key OR a server key). */
export async function breakdownAvailable(): Promise<boolean> {
  if (resolveVoiceKey()) return true;
  return serverConfigured();
}

export interface BreakdownRequest {
  /** The task being decomposed. */
  task: Quest;
  /** Every local task in the holon, so the model reuses instead of recreating. */
  allQuests: Quest[];
  /** Optional holon name / purpose, to ground the decomposition. */
  holonContext?: string;
}

/** Compact the request the same way the web client does before sending. */
function compact(input: BreakdownRequest): {
  task: BreakdownContextTask;
  allTasks: BreakdownContextTask[];
} {
  // Goal task keeps its (nearly) full description; the context list is
  // aggressively truncated — same budgets as the web route.
  const [taskContext] = toBreakdownContext(
    [{ ...input.task, participants: [] }],
    { maxDescriptionChars: BREAKDOWN_MAX_GOAL_DESCRIPTION_CHARS },
  );
  return {
    task: taskContext ?? {
      id: String(input.task.id ?? ""),
      title: input.task.title ?? "",
      status: input.task.status ?? "ongoing",
      dependencies: [],
    },
    allTasks: toBreakdownContext(input.allQuests),
  };
}

/**
 * Resolve a proposal for the task: direct-from-browser when this device holds
 * a key, else through the deploy's serverless function. Throws an `Error`
 * with a kiosk-friendly message on failure.
 */
export async function requestBreakdownProposal(
  input: BreakdownRequest,
): Promise<BreakdownProposal> {
  const key = resolveVoiceKey();
  if (key) return viaOpenAI(key, input);
  if (await serverConfigured()) return viaServer(input);
  throw new Error(
    "AI breakdown is not configured — set OPENAI_API_KEY on the deploy, or paste a key in Settings.",
  );
}

/** The kiosk's own session-gated serverless route (key stays server-side). */
async function viaServer(input: BreakdownRequest): Promise<BreakdownProposal> {
  const { task, allTasks } = compact(input);
  const res = await fetch("/api/ai/breakdown", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, allTasks, holonContext: input.holonContext }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    proposal?: unknown;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data?.error || `AI breakdown failed (${res.status}).`);
  }
  // The route already validated, but never trust parsed network input.
  return parseBreakdownProposal(data.proposal);
}

/** One forced-tool OpenAI chat-completions call straight from the browser. */
async function viaOpenAI(
  key: string,
  input: BreakdownRequest,
): Promise<BreakdownProposal> {
  const { task, allTasks } = compact(input);
  const prompt = buildBreakdownPrompt({
    task,
    allTasks,
    holonContext: input.holonContext,
  });

  const resp = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: BREAKDOWN_MODEL,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: PROPOSE_STEPS_TOOL.name,
            description: PROPOSE_STEPS_TOOL.description,
            parameters: PROPOSE_STEPS_TOOL.input_schema,
          },
        },
      ],
      tool_choice: {
        type: "function",
        function: { name: PROPOSE_STEPS_TOOL_NAME },
      },
    }),
  });
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      throw new Error("OpenAI rejected this device's API key.");
    }
    if (resp.status === 429) {
      throw new Error("OpenAI rate limit hit — try again shortly.");
    }
    throw new Error(`AI breakdown failed (HTTP ${resp.status}).`);
  }

  const data = (await resp.json()) as {
    choices?: {
      message?: { tool_calls?: { function?: { arguments?: unknown } }[] };
    }[];
  };
  const args =
    data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (typeof args !== "string") {
    throw new BreakdownValidationError("the model returned no proposal");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    throw new BreakdownValidationError("the model returned malformed JSON");
  }
  return parseBreakdownProposal(parsed);
}
