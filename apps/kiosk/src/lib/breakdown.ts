// SPDX-License-Identifier: AGPL-3.0-or-later
//
// AI task breakdown for the kiosk — the same feature as the web dashboard's
// /api/ai/breakdown, through the kiosk's own /api/ai/breakdown serverless
// function, which holds the Claude key in the deploy's server env (e.g.
// Netlify site config) — never in the bundle, never on a device. Availability
// is probed once via GET.
//
// All meaning — schema, prompt, proposal validation, materialization — lives
// in @holons/core/tasks; this module only routes the HTTP call.

import {
  BREAKDOWN_MAX_GOAL_DESCRIPTION_CHARS,
  parseBreakdownProposal,
  toBreakdownContext,
  type BreakdownContextTask,
  type BreakdownProposal,
  type Quest,
} from "@holons/core/tasks";
import { tr } from "./i18n";

// Whether the deploy's serverless function holds the AI key, probed once
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

/** Whether this kiosk can break tasks down (its deploy holds the AI key). */
export function breakdownAvailable(): Promise<boolean> {
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
 * Resolve a proposal for the task through the kiosk's session-gated route
 * (the key stays server-side). Throws an `Error` with a kiosk-friendly
 * message on failure.
 */
export async function requestBreakdownProposal(
  input: BreakdownRequest,
): Promise<BreakdownProposal> {
  if (!(await serverConfigured())) {
    throw new Error(
      "AI breakdown is not configured — set ANTHROPIC_API_KEY on the deploy.",
    );
  }
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
    throw new Error(
      data?.error || tr("breakdown.failed", { status: res.status }),
    );
  }
  // The route already validated, but never trust parsed network input.
  return parseBreakdownProposal(data.proposal);
}
