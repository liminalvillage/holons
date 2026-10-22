// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// POST /api/ai/breakdown — ask Claude to decompose a task into steps.
//
// The client sends the target task plus a compact snapshot of every task in
// the holon (so the model links to existing work instead of recreating it);
// we make one structured-output call through @holons/core/ai and return the
// validated proposal. All Holosphere writes happen back in the browser, where
// the user's identity/signing already works — this route never touches the
// store.
//
// Session-gated: without a valid session cookie this would be an open proxy
// to the API key. Non-production builds skip the gate, matching the dev
// auto-login fallback in /api/auth/session.

import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import type { RequestHandler } from "./$types";
import {
  BREAKDOWN_SCHEMA,
  BREAKDOWN_MAX_GOAL_DESCRIPTION_CHARS,
  BreakdownValidationError,
  buildBreakdownPrompt,
  parseBreakdownProposal,
  toBreakdownContext,
  type BreakdownContextTask,
} from "@holons/core/tasks";
import {
  aiConfigured,
  aiModel,
  completeJSON,
  createClaude,
  toAIError,
} from "@holons/core/ai";
import {
  verifySessionIdentity,
  authConfig,
  SESSION_COOKIE,
} from "$lib/server/telegramAuth";

export const POST: RequestHandler = async ({ request, cookies }) => {
  if (!aiConfigured(env)) {
    return json(
      { error: "AI breakdown is not configured (set ANTHROPIC_API_KEY)." },
      { status: 503 },
    );
  }

  if (import.meta.env.PROD) {
    const identity = await verifySessionIdentity(
      cookies.get(SESSION_COOKIE),
      authConfig().jwtSecret,
    );
    if (!identity) {
      return json({ error: "Sign in to use AI breakdown." }, { status: 401 });
    }
  }

  let body: {
    task?: BreakdownContextTask;
    allTasks?: unknown;
    holonContext?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const task = body.task;
  if (!task || typeof task.id !== "string" || typeof task.title !== "string") {
    return json(
      { error: "Body must include task {id, title, ...}." },
      { status: 400 },
    );
  }
  // Re-compact server-side so a hostile/buggy client can't blow the prompt
  // budget regardless of what it sent.
  const allTasks = toBreakdownContext(
    Array.isArray(body.allTasks) ? body.allTasks : [],
  );
  const holonContext =
    typeof body.holonContext === "string"
      ? body.holonContext.slice(0, 500)
      : undefined;

  // The goal task keeps a much larger description budget than the context
  // list — its description is the single richest input to the decomposition.
  const [taskContext] = toBreakdownContext([{ ...task, participants: [] }], {
    maxDescriptionChars: BREAKDOWN_MAX_GOAL_DESCRIPTION_CHARS,
  });
  const prompt = buildBreakdownPrompt({
    task: taskContext ?? { ...task, dependencies: [] },
    allTasks,
    holonContext,
  });

  try {
    const { output, model } = await completeJSON({
      client: createClaude(env),
      model: aiModel(env),
      system: prompt.system,
      user: prompt.user,
      schema: BREAKDOWN_SCHEMA,
      effort: "medium",
    });
    return json({ proposal: parseBreakdownProposal(output), model });
  } catch (err) {
    if (err instanceof BreakdownValidationError) {
      return json(
        { error: `Invalid proposal from the model: ${err.message}` },
        { status: 422 },
      );
    }
    const aiErr = toAIError(err);
    console.error("AI breakdown failed:", aiErr.kind, aiErr.message);
    return json({ error: aiErr.publicMessage }, { status: aiErr.status });
  }
};
