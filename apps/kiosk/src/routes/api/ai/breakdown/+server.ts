// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// POST /api/ai/breakdown — the kiosk twin of the web dashboard's route: ask
// the LLM to decompose a task into steps. OpenAI-only (plain fetch, no SDK),
// with the key read from the deploy's server env (e.g. Netlify site config) so
// it never ships in the client bundle. All Holosphere writes happen back in
// the browser, where the device's signing identity lives — this route never
// touches the store.
//
// GET reports `{ configured }` so the client can decide between this route
// and the device-key direct call (see $lib/breakdown) without shipping the
// key or guessing.
//
// Session-gated: without a valid session cookie this would be an open proxy
// to the OpenAI key. Non-production builds skip the gate, matching the web
// dashboard's dev behavior.

import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import type { RequestHandler } from "./$types";
import {
  PROPOSE_STEPS_TOOL,
  PROPOSE_STEPS_TOOL_NAME,
  BREAKDOWN_MAX_GOAL_DESCRIPTION_CHARS,
  BreakdownValidationError,
  buildBreakdownPrompt,
  parseBreakdownProposal,
  toBreakdownContext,
  type BreakdownContextTask,
} from "@holons/core/tasks";
import {
  verifySession,
  authConfig,
  SESSION_COOKIE,
} from "$lib/server/telegramAuth";

/** Matches the web route's OpenAI fallback model; OPENAI_MODEL overrides it. */
const DEFAULT_OPENAI_MODEL = "gpt-4o";

// Same env names the web route accepts, so one Netlify configuration (or the
// shared root .env in dev) serves both apps.
function openaiKey(): string {
  return (
    env.OPENAI_API_KEY ||
    env.OPENAI ||
    env.VITE_OPENAI_API_KEY ||
    ""
  ).trim();
}

/** Thrown when the OpenAI HTTP call fails, carrying the upstream status. */
class OpenAIError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "OpenAIError";
    this.status = status;
  }
}

/** Whether this deploy can break tasks down server-side. Public, leaks nothing. */
export const GET: RequestHandler = async () => {
  return json({ configured: openaiKey() !== "" });
};

export const POST: RequestHandler = async ({ request, cookies }) => {
  const key = openaiKey();
  if (!key) {
    return json(
      { error: "AI breakdown is not configured (set OPENAI_API_KEY)." },
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
    const model = (env.OPENAI_MODEL || "").trim() || DEFAULT_OPENAI_MODEL;
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
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
              // Structured outputs: without this OpenAI treats `required` as
              // advisory and gpt-4o omits `steps` on atomic proposals.
              strict: true,
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
      const detail = await resp.text().catch(() => "");
      throw new OpenAIError(resp.status, detail.slice(0, 300));
    }
    const data = await resp.json();
    const args =
      data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (typeof args !== "string") {
      throw new BreakdownValidationError("the model returned no proposal");
    }
    let input: unknown;
    try {
      input = JSON.parse(args);
    } catch {
      throw new BreakdownValidationError("the model returned malformed JSON");
    }
    const proposal = parseBreakdownProposal(input);
    return json({ proposal, model: data?.model ?? model });
  } catch (err) {
    if (err instanceof BreakdownValidationError) {
      return json(
        { error: `Invalid proposal from the model: ${err.message}` },
        { status: 422 },
      );
    }
    if (err instanceof OpenAIError) {
      if (err.status === 401 || err.status === 403) {
        return json(
          { error: "AI provider rejected the configured API key." },
          { status: 502 },
        );
      }
      if (err.status === 429) {
        return json(
          { error: "AI provider rate limit hit — try again shortly." },
          { status: 429 },
        );
      }
      console.error("AI breakdown (OpenAI) failed:", err.status, err.message);
      return json(
        { error: "AI request was rejected by the provider." },
        { status: 422 },
      );
    }
    console.error("AI breakdown failed:", err);
    return json({ error: "AI breakdown failed." }, { status: 500 });
  }
};
