// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// POST /api/ai/draft — fill in a record's fields from a description someone
// wrote, so the map's add form can be answered in a sentence instead of field
// by field. Same shape as /api/ai/breakdown next door: OpenAI-only over plain
// fetch, the key read from the deploy's server env so it never reaches the
// client bundle, and session-gated in production because without that this is
// an open proxy to the key. Nothing is written here — the draft goes back to
// the browser as a suggestion in a form someone still has to save.
//
// GET reports `{ configured }`, so the client can choose between this route
// and a device-pasted key without guessing (see $lib/draft).

import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import type { RequestHandler } from "./$types";
import {
  DRAFT_MAX_DESCRIPTION_CHARS,
  DRAFT_MAX_FIELDS,
  DRAFT_TOOL_NAME,
  DraftValidationError,
  buildDraftPrompt,
  buildDraftTool,
  parseDraft,
  type DraftField,
} from "@holons/core/drafting";
import {
  verifySession,
  authConfig,
  SESSION_COOKIE,
} from "$lib/server/telegramAuth";

/** Matches the breakdown route's fallback; OPENAI_MODEL overrides it. */
const DEFAULT_OPENAI_MODEL = "gpt-4o";

const KINDS = new Set([
  "text",
  "long",
  "number",
  "boolean",
  "datetime",
  "choice",
  "list",
]);

function openaiKey(): string {
  return (
    env.OPENAI_API_KEY ||
    env.OPENAI ||
    env.VITE_OPENAI_API_KEY ||
    ""
  ).trim();
}

class OpenAIError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "OpenAIError";
    this.status = status;
  }
}

/**
 * The fields as this route will accept them: a client asking for hundreds of
 * fields, or for prose in place of a field name, must not become the prompt.
 */
function sanitizeFields(input: unknown): DraftField[] {
  if (!Array.isArray(input)) return [];
  const out: DraftField[] = [];
  for (const raw of input.slice(0, DRAFT_MAX_FIELDS)) {
    if (!raw || typeof raw !== "object") continue;
    const f = raw as Record<string, unknown>;
    const name = typeof f.name === "string" ? f.name.trim() : "";
    const kind = typeof f.kind === "string" ? f.kind : "";
    if (!name || name.length > 60 || !KINDS.has(kind)) continue;
    out.push({
      name,
      kind: kind as DraftField["kind"],
      ...(typeof f.label === "string" ? { label: f.label.slice(0, 80) } : {}),
      ...(typeof f.about === "string" ? { about: f.about.slice(0, 300) } : {}),
      ...(Array.isArray(f.options)
        ? {
            options: f.options
              .filter((o): o is string => typeof o === "string")
              .slice(0, 40)
              .map((o) => o.slice(0, 80)),
          }
        : {}),
      ...(f.required === true ? { required: true } : {}),
    });
  }
  return out;
}

/** Whether this deploy can draft server-side. Public, leaks nothing. */
export const GET: RequestHandler = async () => {
  return json({ configured: openaiKey() !== "" });
};

export const POST: RequestHandler = async ({ request, cookies }) => {
  const key = openaiKey();
  if (!key) {
    return json(
      { error: "AI drafting is not configured (set OPENAI_API_KEY)." },
      { status: 503 },
    );
  }

  if (import.meta.env.PROD) {
    const profile = await verifySession(
      cookies.get(SESSION_COOKIE),
      authConfig().jwtSecret,
    );
    if (!profile) {
      return json({ error: "Sign in to use AI drafting." }, { status: 401 });
    }
  }

  let body: {
    kind?: unknown;
    description?: unknown;
    fields?: unknown;
    place?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const description =
    typeof body.description === "string"
      ? body.description.slice(0, DRAFT_MAX_DESCRIPTION_CHARS).trim()
      : "";
  const fields = sanitizeFields(body.fields);
  if (!description || !fields.length) {
    return json(
      { error: "Body must include a description and the fields to fill." },
      { status: 400 },
    );
  }
  const kind =
    typeof body.kind === "string" && body.kind.trim()
      ? body.kind.trim().slice(0, 60)
      : "record";
  const p = body.place as { lat?: unknown; lon?: unknown } | null | undefined;
  const place =
    p && typeof p.lat === "number" && typeof p.lon === "number"
      ? { lat: p.lat, lon: p.lon }
      : null;

  const prompt = buildDraftPrompt({ kind, description, fields, place });
  const tool = buildDraftTool(fields);

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
      const detail = await resp.text().catch(() => "");
      throw new OpenAIError(resp.status, detail.slice(0, 300));
    }
    const data = await resp.json();
    const args =
      data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (typeof args !== "string") {
      throw new DraftValidationError("the model returned no fields");
    }
    let input: unknown;
    try {
      input = JSON.parse(args);
    } catch {
      throw new DraftValidationError("the model returned malformed JSON");
    }
    return json({
      values: parseDraft(input, fields),
      model: data?.model ?? model,
    });
  } catch (err) {
    if (err instanceof DraftValidationError) {
      return json(
        { error: `Invalid draft from the model: ${err.message}` },
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
      console.error("AI draft (OpenAI) failed:", err.status, err.message);
      return json(
        { error: "AI request was rejected by the provider." },
        { status: 422 },
      );
    }
    console.error("AI draft failed:", err);
    return json({ error: "AI draft failed." }, { status: 500 });
  }
};
