// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// POST /api/ai/breakdown — ask the LLM to decompose a task into steps.
//
// The client sends the target task plus a compact snapshot of every task in
// the holon (so the model links to existing work instead of recreating it);
// we make a single forced-tool Anthropic call and return the validated
// proposal. All Holosphere writes happen back in the browser, where the
// user's identity/signing already works — this route never touches GUN.
//
// Session-gated: without a valid session cookie this would be an open proxy
// to the Anthropic API key. Non-production builds skip the gate, matching
// the dev auto-login fallback in /api/auth/session.

import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import type { RequestHandler } from "./$types";
import Anthropic from "@anthropic-ai/sdk";
import {
  PROPOSE_STEPS_TOOL,
  PROPOSE_STEPS_TOOL_NAME,
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

// Matches ai-ui's ANTHROPIC_DEFAULT_MODEL; HOLONS_AI_MODEL overrides both.
const DEFAULT_MODEL = "claude-sonnet-4-6";

function apiKey(): string {
  // Prefer the server-only key; fall back to the legacy VITE_-prefixed entry
  // already present in the root .env (that one is client-bundled — adding a
  // plain ANTHROPIC_API_KEY is the recommended setup).
  return (env.ANTHROPIC_API_KEY || env.VITE_ANTHROPIC_API_KEY || "").trim();
}

export const POST: RequestHandler = async ({ request, cookies }) => {
  const key = apiKey();
  if (!key) {
    return json(
      { error: "AI breakdown is not configured (missing ANTHROPIC_API_KEY)." },
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

  const [taskContext] = toBreakdownContext([{ ...task, participants: [] }]);
  const prompt = buildBreakdownPrompt({
    task: taskContext ?? { ...task, dependencies: [] },
    allTasks,
    holonContext,
  });

  const client = new Anthropic({ apiKey: key });
  const model = (env.HOLONS_AI_MODEL || "").trim() || DEFAULT_MODEL;
  try {
    const resp = await client.messages.create({
      model,
      max_tokens: 8192,
      system: prompt.system,
      tools: [PROPOSE_STEPS_TOOL as Anthropic.Tool],
      tool_choice: {
        type: "tool",
        name: PROPOSE_STEPS_TOOL_NAME,
        disable_parallel_tool_use: true,
      },
      messages: [{ role: "user", content: prompt.user }],
    });
    const toolUse = resp.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name === PROPOSE_STEPS_TOOL_NAME,
    );
    if (!toolUse) {
      return json(
        { error: "The model returned no proposal." },
        { status: 502 },
      );
    }
    const proposal = parseBreakdownProposal(toolUse.input);
    return json({ proposal, model: resp.model });
  } catch (err) {
    if (err instanceof BreakdownValidationError) {
      return json(
        { error: `Invalid proposal from the model: ${err.message}` },
        { status: 422 },
      );
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return json(
        { error: "AI provider rejected the configured API key." },
        { status: 502 },
      );
    }
    if (err instanceof Anthropic.RateLimitError) {
      return json(
        { error: "AI provider rate limit hit — try again shortly." },
        { status: 429 },
      );
    }
    if (err instanceof Anthropic.BadRequestError) {
      return json(
        { error: "AI request was rejected by the provider." },
        { status: 422 },
      );
    }
    console.error("AI breakdown failed:", err);
    return json({ error: "AI breakdown failed." }, { status: 500 });
  }
};
