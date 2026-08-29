// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// POST /api/ai/breakdown — ask the LLM to decompose a task into steps.
//
// The client sends the target task plus a compact snapshot of every task in
// the holon (so the model links to existing work instead of recreating it);
// we make a single forced-tool LLM call — Anthropic when a key is configured,
// falling back to OpenAI chat completions — and return the validated
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
  BREAKDOWN_MAX_GOAL_DESCRIPTION_CHARS,
  BreakdownValidationError,
  buildBreakdownPrompt,
  parseBreakdownProposal,
  toBreakdownContext,
  type BreakdownContextTask,
} from "@holons/core/tasks";
import {
  verifySessionIdentity,
  authConfig,
  SESSION_COOKIE,
} from "$lib/server/telegramAuth";

// Matches ai-ui's ANTHROPIC_DEFAULT_MODEL; HOLONS_AI_MODEL overrides it.
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const DEFAULT_OPENAI_MODEL = "gpt-4o";

// Anthropic is preferred when configured; otherwise fall back to the OpenAI
// key already present in the root .env. The VITE_-prefixed entries are
// client-bundled legacies — plain server-only names are the recommended
// setup for both providers.
function anthropicKey(): string {
  return (env.ANTHROPIC_API_KEY || env.VITE_ANTHROPIC_API_KEY || "").trim();
}
function openaiKey(): string {
  return (
    env.OPENAI_API_KEY ||
    env.OPENAI ||
    env.VITE_OPENAI_API_KEY ||
    ""
  ).trim();
}

interface BreakdownPrompt {
  system: string;
  user: string;
}

/** One forced-tool Anthropic turn; returns the raw tool input + model used. */
async function callAnthropic(
  key: string,
  prompt: BreakdownPrompt,
): Promise<{ input: unknown; model: string }> {
  const client = new Anthropic({ apiKey: key });
  const model = (env.HOLONS_AI_MODEL || "").trim() || DEFAULT_ANTHROPIC_MODEL;
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
  if (!toolUse)
    throw new BreakdownValidationError("the model returned no proposal");
  return { input: toolUse.input, model: resp.model };
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

/**
 * Same forced tool call through OpenAI chat completions (plain fetch — the
 * schema is provider-neutral, so no extra SDK is needed for the fallback).
 */
async function callOpenAI(
  key: string,
  prompt: BreakdownPrompt,
): Promise<{ input: unknown; model: string }> {
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
  return { input, model: data?.model ?? model };
}

export const POST: RequestHandler = async ({ request, cookies }) => {
  const aKey = anthropicKey();
  const oKey = openaiKey();
  if (!aKey && !oKey) {
    return json(
      {
        error:
          "AI breakdown is not configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY).",
      },
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
    const { input, model } = aKey
      ? await callAnthropic(aKey, prompt)
      : await callOpenAI(oKey, prompt);
    const proposal = parseBreakdownProposal(input);
    return json({ proposal, model });
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
