// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// POST /api/ai/breakdown — the kiosk twin of the web dashboard's route: ask
// Claude to decompose a task into steps, through @holons/core/ai, with the key
// read from the deploy's server env (e.g. Netlify site config) so it never
// ships in the client bundle. All Holosphere writes happen back in the
// browser, where the device's signing identity lives — this route never
// touches the store.
//
// GET reports `{ configured }` so the client knows whether to offer the
// breakdown, without shipping the key or guessing.
//
// Session-gated: without a valid session cookie this would be an open proxy
// to the key. Non-production builds skip the gate, matching the web
// dashboard's dev behavior.

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
  verifySession,
  authConfig,
  SESSION_COOKIE,
} from "$lib/server/telegramAuth";

/** Whether this deploy can break tasks down server-side. Public, leaks nothing. */
export const GET: RequestHandler = async () => {
  return json({ configured: aiConfigured(env) });
};

export const POST: RequestHandler = async ({ request, cookies }) => {
  if (!aiConfigured(env)) {
    return json(
      { error: "AI breakdown is not configured (set ANTHROPIC_API_KEY)." },
      { status: 503 },
    );
  }

  if (import.meta.env.PROD) {
    const profile = await verifySession(
      cookies.get(SESSION_COOKIE),
      authConfig().jwtSecret,
    );
    if (!profile) {
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
